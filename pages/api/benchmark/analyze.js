import { analysesCollection } from '../../../lib/mongodb'
import { redis } from '../../../lib/redis'
import { runAnalysis } from '../../../lib/engines/runner'
import { enqueueMultiRuntimeJob } from '../../../lib/engines/multiruntime'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../../lib/rateLimit'
import crypto from 'crypto'

// Deep analysis boots V8/QuickJS sandboxes (~25-30s of CPU per call), so a
// per-minute window let a free IP sustain ~60 runs/hour. A 5-minute window
// caps free users at 24/hour while still allowing a quick iteration burst,
// and donors get 10 per 5 minutes for comfortable back-to-back tweaking.
const RATE_LIMIT = { free: 2, donor: 10, window: '5 m' }

// Next.js requires segment config to be statically analyzable, so this
// has to be a literal — no env-conditional expression. 60s is the Hobby
// plan ceiling; we deliberately stay inside it by NOT running multi-runtime
// inline. The multi-runtime worker is enqueued asynchronously and the
// browser polls /api/benchmark/multi-runtime/[jobId] for results, so the
// length of the worker run does not contribute to this function's wall time.
//
// Synchronous budget:
//   - QuickJS:    4 profiles × ~1.5s ≈ 6s
//   - V8 sandbox: 4 profiles × ~5-8s ≈ 25-30s (sandbox boot dominates)
//   - Prediction: <100ms
//   - Total:      ~35s, leaving headroom for slow cold starts.
export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const rl = await applyTieredRateLimit(req, 'analyze', RATE_LIMIT)
    setRateLimitHeaders(res, rl)
    if (!rl.success) {
      const cap = rl.tier === 'donor' ? RATE_LIMIT.donor : RATE_LIMIT.free
      return res.status(429).json({
        error: `Too many requests. Deep analysis is limited to ${cap} every 5 minutes${rl.tier === 'donor' ? ' for donors' : ''}.`,
        tier: rl.tier,
      })
    }

    const { tests, setup, teardown, slug, revision, force } = req.body
    const multiRuntimeOptions = parseMultiRuntimeOptions(req.body)

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({ error: 'tests array is required and must not be empty' })
    }

    if (tests.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 tests per analysis' })
    }

    for (const test of tests) {
      if (!test.code || typeof test.code !== 'string') {
        return res.status(400).json({ error: 'Each test must have a non-empty code string' })
      }
    }

    // Cache by content hash. Two separate cache scopes:
    //   - analysis_v4:<hash>     base analysis (QuickJS + V8 + prediction)
    //   - mr_v1:<hash>           per-test multi-runtime results, fetched
    //                            and embedded by the polling client through
    //                            /api/benchmark/multi-runtime/[jobId]
    // We keep them separate because base and MR have very different
    // refresh cadences (base is deterministic; MR can vary with worker
    // host load) and so a stale cache in one shouldn't shadow the other.
    const codeHash = computeCodeHash(tests, setup, teardown)
    const multiRuntimeCacheKey = computeMultiRuntimeCacheKey(tests, setup, teardown, multiRuntimeOptions)
    const cacheKey = `analysis_v4:${codeHash}`

    // `force: true` from the "Re-analyze" button busts the Redis cache
    // so the user always gets a fresh QuickJS+V8 run. The MongoDB
    // snapshot is still appended below — the latest doc wins for future
    // page loads.
    if (force === true) {
      try { await redis.del(cacheKey) } catch (_) { /* non-fatal */ }
    }

    const cached = !force ? await redis.get(cacheKey) : null
    if (cached) {
      const cachedData = typeof cached === 'string' ? JSON.parse(cached) : cached
      // On cache HIT we still need to give the client fresh MR jobIds so
      // it can poll for new MR data (or pick up cached MR from the proxy
      // endpoint, which has its own per-hash cache).
      const mrInfo = await maybeEnqueueMultiRuntime(tests, setup, teardown, multiRuntimeCacheKey, multiRuntimeOptions)
      const merged = { ...mergeMultiRuntimeMeta(cachedData, mrInfo), codeHash }
      res.setHeader('X-Analysis-Cache', 'HIT')
      return res.status(200).json(merged)
    }

    // Stream NDJSON progress + final result
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Analysis-Cache', 'MISS')
    res.status(200)

    const sendLine = (obj) => {
      res.write(JSON.stringify(obj) + '\n')
    }

    // Tell the client which engines are part of this run so it can render
    // the full step list immediately. 'multi-runtime' shows up as a step
    // even though it's not done by this function — the client tracks it
    // separately via polling.
    const enabledEngines = ['quickjs', 'v8']
    if (process.env.BENCHMARK_WORKER_URL) enabledEngines.push('multi-runtime')
    enabledEngines.push('prediction')
    sendLine({ type: 'pipeline', engines: enabledEngines })

    // Kick off MR jobs FIRST so they run on the worker concurrently with
    // QuickJS+V8 here. By the time we finish those phases the worker is
    // typically already done, so the client's first poll gets results.
    const mrInfo = await maybeEnqueueMultiRuntime(tests, setup, teardown, multiRuntimeCacheKey, multiRuntimeOptions)
    if (mrInfo?.jobs) {
      sendLine({
        type: 'multi-runtime-enqueued',
        jobs: mrInfo.jobs,
        codeHash: multiRuntimeCacheKey,
        deadlineMs: mrInfo.deadlineMs,
      })
    } else if (mrInfo?.error) {
      sendLine({ type: 'multi-runtime-unavailable', error: mrInfo.error })
    }

    const analysis = await runAnalysis(tests, {
      setup: setup || undefined,
      teardown: teardown || undefined,
      timeMs: 2000,
      onProgress: (step) => sendLine({ type: 'progress', ...step }),
    })

    const analyses = await analysesCollection()
    const doc = {
      codeHash,
      slug: slug ? String(slug) : null,
      revision: revision ? parseInt(revision, 10) : null,
      results: analysis.results,
      comparison: analysis.comparison,
      hasErrors: analysis.hasErrors || false,
      createdAt: new Date(),
    }
    await analyses.insertOne(doc)

    if (!analysis.hasErrors) {
      await redis.setex(cacheKey, 3600, JSON.stringify(analysis))
    }

    const final = { ...mergeMultiRuntimeMeta(analysis, mrInfo), codeHash }
    sendLine({ type: 'result', data: final })
    return res.end()
  } catch (error) {
    console.error('Analysis error:', error)

    if (res.headersSent) {
      const errMsg = error.name === 'AbortError' ? 'Analysis timed out' : 'Internal Server Error'
      res.write(JSON.stringify({ type: 'error', error: errMsg }) + '\n')
      return res.end()
    }

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out' })
    }

    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

/**
 * Enqueue one MR job per test on the remote worker. Returns:
 *   { jobs: [{ testIndex, jobId }, ...], deadlineMs }     on success
 *   { error: string }                                     when worker is
 *                                                         configured but
 *                                                         unreachable
 *   null                                                  when the worker
 *                                                         is not configured
 */
async function maybeEnqueueMultiRuntime(tests, setup, teardown, cacheKey, options = {}) {
  if (!process.env.BENCHMARK_WORKER_URL) return null

  const enqueues = await Promise.all(tests.map((t, i) =>
    enqueueMultiRuntimeJob(t.code, { setup, teardown, timeMs: 1500, ...options })
      .then(res => ({ testIndex: i, res }))
      .catch(err => ({ testIndex: i, res: { unavailable: true, error: err.message || String(err) } }))
  ))

  const successes = enqueues.filter(e => e.res?.jobId)
  if (successes.length === 0) {
    const firstError = enqueues.find(e => e.res?.unavailable)?.res?.error
    return { error: firstError || 'Failed to enqueue multi-runtime jobs' }
  }

  // Cache the testIndex → jobId map so the polling proxy endpoint can
  // surface the most-recent run for this runtime selection if a user refreshes
  // before the MR job completes.
  try {
    await redis.setex(
      `mr_jobs_v1:${cacheKey}`,
      300,
      JSON.stringify(successes.map(s => ({ testIndex: s.testIndex, jobId: s.res.jobId }))),
    )
  } catch (_) { /* non-fatal */ }

  return {
    jobs: successes.map(s => ({ testIndex: s.testIndex, jobId: s.res.jobId })),
    deadlineMs: successes[0].res.deadlineMs,
    cacheKey,
  }
}

function mergeMultiRuntimeMeta(analysis, mrInfo) {
  if (!mrInfo) return analysis
  return {
    ...analysis,
    multiRuntime: mrInfo.jobs
      ? { jobs: mrInfo.jobs, deadlineMs: mrInfo.deadlineMs, cacheKey: mrInfo.cacheKey }
      : { unavailable: true, error: mrInfo.error },
  }
}

function computeCodeHash(tests, setup, teardown) {
  const content = JSON.stringify({
    tests: tests.map(t => ({ code: t.code.trim() })),
    setup: (setup || '').trim(),
    teardown: (teardown || '').trim(),
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function computeMultiRuntimeCacheKey(tests, setup, teardown, options) {
  const content = JSON.stringify({
    tests: tests.map(t => ({ code: t.code.trim() })),
    setup: (setup || '').trim(),
    teardown: (teardown || '').trim(),
    runtimes: options.runtimes || null,
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function parseMultiRuntimeOptions(body) {
  const runtimes = normalizeRuntimeRequest(body?.runtimes)
  return runtimes ? { runtimes } : {}
}

function normalizeRuntimeRequest(input) {
  if (!Array.isArray(input)) return null

  const cleaned = input
    .slice(0, 12)
    .map((item) => {
      if (typeof item === 'string') {
        const value = item.trim()
        return value.length > 0 && value.length <= 100 ? value : null
      }
      if (!item || typeof item !== 'object') return null
      const runtime = typeof item.runtime === 'string' ? item.runtime.trim() : ''
      const version = item.version == null ? null : String(item.version).trim()
      if (!runtime || runtime.length > 20) return null
      if (version != null && (!version || version.length > 100)) return null
      return version == null ? { runtime } : { runtime, version }
    })
    .filter(Boolean)

  return cleaned.length > 0 ? cleaned : null
}
