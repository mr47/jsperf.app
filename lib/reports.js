/**
 * Report builder + ID generator.
 *
 * A "report" is a frozen snapshot of one benchmark revision plus
 * whatever additional analysis data the donor had at the moment they
 * generated it. Once stored, the URL `/r/<id>` stays stable forever
 * — even if the source benchmark is edited, deleted, or the analysis
 * cache rotates. That's important because reports are meant to be
 * pasted into slide decks and shared.
 */
import crypto from 'crypto'
import {
  pagesCollection,
  runsCollection,
  analysesCollection,
  reportsCollection,
} from './mongodb'
import { attachStoredMultiRuntimeResults } from './multiRuntimeResults'

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'  // no 0/1/i/l/o (visually unambiguous)
const ID_LENGTH = 8
const MAX_ID_ATTEMPTS = 8
const MAX_TESTS_SNAPSHOT = 50
const MAX_REPORTS_PER_DONOR_PER_HOUR = 30

function generateId() {
  const bytes = crypto.randomBytes(ID_LENGTH * 2)
  let out = ''
  for (let i = 0; i < bytes.length && out.length < ID_LENGTH; i++) {
    const idx = bytes[i] & 0x1f
    if (idx < ID_ALPHABET.length) out += ID_ALPHABET[idx]
  }
  // Topping-up with a fallback (vanishingly rare with the alphabet
  // size, but keeps the contract that IDs are always exactly
  // ID_LENGTH chars).
  while (out.length < ID_LENGTH) {
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
  }
  return out
}

/**
 * Build the per-test browser/OS breakdown the same way /api/stats does.
 * We snapshot the result so report URLs don't depend on the live cache.
 */
async function snapshotStats(slug, revision) {
  const runs = await runsCollection()
  const pipeline = [
    { $match: { slug: String(slug), revision: parseInt(revision, 10) } },
    { $unwind: '$results' },
    { $match: { 'results.opsPerSec': { $gt: 0 } } },
    {
      $group: {
        _id: {
          testIndex: '$results.testIndex',
          browserName: { $ifNull: ['$browserName', 'unknown'] },
          osName: { $ifNull: ['$osName', 'unknown'] },
          cpuArch: { $ifNull: ['$cpuArch', 'unknown'] },
        },
        avgOps: { $avg: '$results.opsPerSec' },
        count: { $sum: 1 },
      },
    },
    { $sort: { avgOps: -1 } },
    {
      $group: {
        _id: '$_id.testIndex',
        stats: {
          $push: {
            browserName: '$_id.browserName',
            osName: '$_id.osName',
            cpuArch: '$_id.cpuArch',
            avgOps: '$avgOps',
            count: '$count',
          },
        },
      },
    },
  ]
  const aggregation = await runs.aggregate(pipeline).toArray()
  const out = {}
  for (const row of aggregation) out[row._id] = row.stats
  return out
}

/**
 * Compute the lightweight summary we surface on the report's title
 * slide and use to pick "winner" / "lagger" tiles. We do this server-
 * side so the viewer can render it instantly without re-running any
 * analysis.
 *
 * Strategy: prefer the same canonical ops/sec Deep Analysis shows
 * (V8 single-vCPU result, QuickJS fallback), otherwise fall back to
 * an ops-weighted average from browser run data.
 */
function computeSummary({ benchmark, stats, analysis }) {
  const tests = benchmark?.tests || []
  if (!tests.length) return { entries: [], leader: null, lagger: null, speedup: null }

  const entries = tests.map((test, i) => {
    let opsPerSec = null
    let source = null

    const aRes = analysis?.results?.find(r => r.testIndex === i)
    const canonical = canonicalAnalysisOps(aRes)
    if (canonical?.opsPerSec) {
      opsPerSec = canonical.opsPerSec
      source = canonical.source
    }

    if (!opsPerSec) {
      const env = stats?.[i] || stats?.[String(i)] || []
      let total = 0
      let count = 0
      for (const s of env) {
        if (s?.avgOps > 0 && s?.count > 0) {
          total += s.avgOps * s.count
          count += s.count
        }
      }
      if (count > 0) {
        opsPerSec = total / count
        source = 'runs'
      }
    }

    return {
      testIndex: i,
      title: test.title || `Test ${i + 1}`,
      code: typeof test.code === 'string' ? test.code.slice(0, 4000) : '',
      async: !!test.async,
      opsPerSec: opsPerSec || 0,
      source,
    }
  })

  const ranked = entries
    .filter(e => e.opsPerSec > 0)
    .sort((a, b) => b.opsPerSec - a.opsPerSec)

  const leader = ranked[0] || null
  const lagger = ranked[ranked.length - 1] || null
  const speedup = leader && lagger && lagger.opsPerSec > 0
    ? leader.opsPerSec / lagger.opsPerSec
    : null

  return {
    entries,
    ranked,
    leader,
    lagger,
    speedup,
    dataSource: leader?.source || null,
  }
}

function canonicalAnalysisOps(result) {
  if (!result) return null
  if (result.v8?.opsPerSec > 0) {
    return { opsPerSec: result.v8.opsPerSec, source: 'v8' }
  }
  if (result.quickjs?.opsPerSec > 0) {
    return { opsPerSec: result.quickjs.opsPerSec, source: 'quickjs' }
  }
  return null
}

// Raw perf-event keys (`cache-misses`, `branch-misses`, ...) come from
// `perf stat` and need to be mapped to the camelCase keys the report
// viewer expects. Without this mapping, only `cycles` and `instructions`
// would survive into the persisted snapshot — which broke the radar
// chart, since the other axes always showed up empty.
const PERF_KEY_ALIASES = {
  cycles: 'cycles',
  instructions: 'instructions',
  branches: 'branches',
  'branch-instructions': 'branches',
  'branch-misses': 'branchMisses',
  branchMisses: 'branchMisses',
  'cache-misses': 'cacheMisses',
  cacheMisses: 'cacheMisses',
  'cache-references': 'cacheReferences',
  cacheReferences: 'cacheReferences',
  'page-faults': 'pageFaults',
  pageFaults: 'pageFaults',
  'context-switches': 'contextSwitches',
  contextSwitches: 'contextSwitches',
}

function compactPerfCounters(pc) {
  if (!pc || typeof pc !== 'object') return null
  const out = {}
  for (const [rawKey, value] of Object.entries(pc)) {
    if (value == null) continue
    const canonical = PERF_KEY_ALIASES[rawKey]
    if (canonical) out[canonical] = value
  }
  return Object.keys(out).length ? out : null
}

function compactProfile(p) {
  if (!p) return null
  return {
    opsPerSec: p.opsPerSec ?? null,
    samples: p.samples ?? null,
    state: p.state ?? null,
    profile: p.profile ?? null,
    runtime: p.runtime ?? null,
    label: p.label ?? null,
    resourceLevel: p.resourceLevel ?? null,
    memoryMB: p.memoryMB ?? null,
    vcpus: p.vcpus ?? null,
    methodology: p.methodology ?? null,
    perfCounters: compactPerfCounters(p.perfCounters),
  }
}

/**
 * Normalise the per-test multi-runtime data into a single, predictable
 * shape regardless of whether it came from the worker proxy
 * (object keyed by runtime name → {profiles, avgOpsPerSec}) or from a
 * legacy DB-stored shape (array of profiles).
 *
 * Output shape per test:
 *   { byRuntime: { node: {avgOpsPerSec, profiles: [...]}, ... } }
 *
 * Returns null when there's no usable data so the deck builder can
 * skip runtime-related slides cleanly.
 */
function normaliseMultiRuntime(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) {
    const byRuntime = {}
    for (const p of raw) {
      const key = (p?.runtime || p?.profile || 'runtime').toString()
      if (!byRuntime[key]) byRuntime[key] = { profiles: [], avgOpsPerSec: 0 }
      const cp = compactProfile(p)
      if (cp) byRuntime[key].profiles.push(cp)
    }
    for (const k of Object.keys(byRuntime)) {
      const ops = byRuntime[k].profiles.map(p => p.opsPerSec).filter(v => v > 0)
      byRuntime[k].avgOpsPerSec = ops.length ? ops.reduce((a, b) => a + b, 0) / ops.length : 0
    }
    return Object.keys(byRuntime).length ? { byRuntime } : null
  }
  if (typeof raw !== 'object') return null
  const byRuntime = {}
  for (const [name, data] of Object.entries(raw)) {
    if (!data || typeof data !== 'object') continue
    const profiles = (data.profiles || []).map(compactProfile).filter(Boolean)
    let avg = Number(data.avgOpsPerSec) || 0
    if (!avg && profiles.length) {
      const ops = profiles.map(p => p.opsPerSec).filter(v => v > 0)
      avg = ops.length ? ops.reduce((a, b) => a + b, 0) / ops.length : 0
    }
    byRuntime[name] = {
      avgOpsPerSec: avg,
      profiles,
      hasError: Boolean(data.hasError) || Boolean(data.error),
    }
  }
  return Object.keys(byRuntime).length ? { byRuntime } : null
}

/**
 * Trim + normalise a deep-analysis document down to what the report
 * viewer renders. Stays well under Mongo's 16MB doc limit even for
 * very wide benchmarks.
 */
function snapshotAnalysis(analysis) {
  if (!analysis) return null
  return {
    comparison: analysis.comparison || null,
    hasErrors: analysis.hasErrors || false,
    results: (analysis.results || []).slice(0, MAX_TESTS_SNAPSHOT).map(r => ({
      testIndex: r.testIndex,
      title: r.title || null,
      v8: r.v8 ? {
        opsPerSec: r.v8.opsPerSec ?? null,
        profiles: (r.v8.profiles || []).map(compactProfile).filter(Boolean),
      } : null,
      quickjs: r.quickjs ? {
        opsPerSec: r.quickjs.opsPerSec ?? null,
        profiles: (r.quickjs.profiles || []).map(compactProfile).filter(Boolean),
      } : null,
      multiRuntime: normaliseMultiRuntime(r.multiRuntime),
      runtimeComparison: r.runtimeComparison || null,
      prediction: r.prediction || null,
      complexity: r.complexity || null,
    })),
  }
}

/**
 * Merge a multi-runtime polling snapshot (the shape returned by
 * /api/benchmark/multi-runtime/[jobId] and aggregated client-side
 * into `multiRuntimeData.results`) onto an analysis whose results
 * don't yet carry it. We do this server-side so the persisted report
 * is self-contained — viewers don't need to re-poll anything.
 */
function mergeClientMultiRuntime(analysis, mrData) {
  if (!analysis || !mrData?.results) return analysis
  const byIndex = new Map(mrData.results.map(r => [r.testIndex, r]))
  const merged = {
    ...analysis,
    results: (analysis.results || []).map(r => {
      const mr = byIndex.get(r.testIndex)
      if (!mr || mr.state !== 'done') return r
      return {
        ...r,
        multiRuntime: mr.runtimes,
        runtimeComparison: mr.runtimeComparison || null,
      }
    }),
  }
  return merged
}

/**
 * Snapshot a benchmark page document. We deliberately drop fields
 * that aren't useful in a presentation context (uuid, githubID,
 * mirror metadata, etc.) so we don't accidentally expose anything.
 */
function snapshotBenchmark(page) {
  return {
    slug: page.slug,
    revision: page.revision,
    title: page.title || 'Untitled benchmark',
    info: page.info || null,
    authorName: page.authorName || null,
    initHTML: page.initHTML || null,
    setup: page.setup || null,
    teardown: page.teardown || null,
    published: page.published || null,
    tests: (page.tests || []).slice(0, MAX_TESTS_SNAPSHOT).map(t => ({
      title: t.title,
      code: t.code,
      async: !!t.async,
    })),
  }
}

/**
 * Build + persist a report. Returns { id, url, report }.
 *
 * `donor` must be the resolved donor session — callers are expected
 * to gate on it before calling this function.
 */
export async function createReport({
  slug,
  revision,
  theme = 'auto',
  donor,
  clientAnalysis = null,
  clientMultiRuntime = null,
}) {
  if (!slug || revision == null) throw new Error('slug and revision are required')
  if (!donor?.name) throw new Error('a donor is required to create a report')

  const rev = parseInt(revision, 10)
  if (!Number.isFinite(rev) || rev < 1) throw new Error('invalid revision')

  // Per-donor abuse guard: each donor can mint at most N reports per
  // rolling hour. Stops a runaway script from filling the collection.
  const reports = await reportsCollection()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recent = await reports.countDocuments({
    'creator.name': donor.name,
    createdAt: { $gte: oneHourAgo },
  })
  if (recent >= MAX_REPORTS_PER_DONOR_PER_HOUR) {
    const err = new Error('Report quota exceeded — please try again later.')
    err.code = 'RATE_LIMITED'
    throw err
  }

  const pages = await pagesCollection()
  const page = await pages.findOne({ slug: String(slug), revision: rev })
  if (!page || page.visible === false) {
    const err = new Error('Source benchmark not found')
    err.code = 'NOT_FOUND'
    throw err
  }

  // Prefer the live client-supplied analysis, and fall back to the most recent
  // stored analysis otherwise. Multi-runtime data may arrive asynchronously, so
  // hydrate it from durable storage before snapshotting the report.
  let rawAnalysis = null
  if (clientAnalysis && Array.isArray(clientAnalysis.results)) {
    rawAnalysis = mergeClientMultiRuntime(clientAnalysis, clientMultiRuntime)
  } else {
    const analyses = await analysesCollection()
    rawAnalysis = await analyses.findOne(
      { slug: String(slug), revision: rev },
      { sort: { createdAt: -1 } },
    )
  }
  const multiRuntimeKey = rawAnalysis?.multiRuntimeCacheKey ||
    rawAnalysis?.multiRuntime?.cacheKey ||
    rawAnalysis?.codeHash ||
    null
  rawAnalysis = await attachStoredMultiRuntimeResults(rawAnalysis, multiRuntimeKey)

  const benchmark = snapshotBenchmark(page)
  const stats = await snapshotStats(slug, rev)
  const analysis = snapshotAnalysis(rawAnalysis)
  const summary = computeSummary({ benchmark, stats, analysis })

  // Avoid the (extremely unlikely) ID collision by retrying a few
  // times. Mongo's insert with a unique index would also catch this.
  let id = null
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const candidate = generateId()
    const existing = await reports.findOne({ id: candidate }, { projection: { _id: 1 } })
    if (!existing) { id = candidate; break }
  }
  if (!id) throw new Error('Could not allocate a unique report id')

  const doc = {
    id,
    slug: String(slug),
    revision: rev,
    title: benchmark.title,
    theme,
    creator: {
      name: donor.name,
      source: donor.source || 'donate',
      email: donor.email || null,
    },
    benchmark,
    stats,
    analysis,
    summary,
    createdAt: new Date(),
    views: 0,
  }

  await reports.insertOne(doc)

  return {
    id,
    url: `/r/${id}`,
    report: doc,
  }
}

export async function getReportById(id) {
  if (!id || typeof id !== 'string') return null
  const reports = await reportsCollection()
  return reports.findOne({ id })
}

export async function bumpReportViews(id) {
  if (!id) return
  const reports = await reportsCollection()
  await reports.updateOne({ id }, { $inc: { views: 1 } })
}

/** List a donor's own reports (for a future "my reports" panel). */
export async function listReportsForDonor(donorName, { limit = 20 } = {}) {
  if (!donorName) return []
  const reports = await reportsCollection()
  return reports
    .find({ 'creator.name': donorName }, { projection: { id: 1, title: 1, slug: 1, revision: 1, createdAt: 1, views: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
}

export async function deleteReport({ id, donorName }) {
  if (!id) return false
  const reports = await reportsCollection()
  const result = await reports.deleteOne({ id, 'creator.name': donorName })
  return result.deletedCount > 0
}
