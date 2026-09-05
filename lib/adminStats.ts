/**
 * Dashboard numbers for the admin panel.
 *
 * Everything here is best-effort: each metric is wrapped so a slow or
 * failing query yields `null` for that tile instead of a 500. Counts on
 * large collections use `estimatedDocumentCount` (metadata, O(1)) for
 * totals and time-bounded `countDocuments` for windows. The whole
 * payload is cached in Redis for a minute.
 */
import { redis } from './redis'
import {
  analysesCollection,
  errorsCollection,
  getDatabase,
  ipBansCollection,
  multiRuntimeAnalysesCollection,
  pagesCollection,
  reportsCollection,
  runsCollection,
  usersCollection,
} from './mongodb'
import { errorSummary } from './errorLog'
import { listAudit } from './users'

const CACHE_KEY = 'admin:stats:v1'
const CACHE_TTL_SECONDS = 60
const QUERY_TIMEOUT_MS = 8000
const DAY = 24 * 60 * 60 * 1000

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.warn(`[admin-stats] ${label} failed:`, (err as Error)?.message || err)
    return null
  }
}

function since(days: number) {
  return new Date(Date.now() - days * DAY)
}

/** Count keys matching a pattern with a bounded SCAN (never a full KEYS). */
async function countRedisKeys(pattern: string, maxIterations = 50): Promise<{ count: number; complete: boolean }> {
  let cursor: string | number = 0
  let count = 0
  for (let i = 0; i < maxIterations; i++) {
    const [next, keys] = await redis.scan(cursor, { match: pattern, count: 500 })
    count += keys.length
    cursor = next
    if (String(next) === '0') return { count, complete: true }
  }
  return { count, complete: false }
}

export type IndexCheck = {
  collection: string
  name: string
  keys: Record<string, 1 | -1>
  present: boolean
  reason: string
}

/**
 * Indexes the hot read paths rely on. Missing ones show up on the
 * dashboard and can be created from there.
 */
export const RECOMMENDED_INDEXES: Array<Omit<IndexCheck, 'present'>> = [
  { collection: 'pages', name: 'slug_1_revision_1', keys: { slug: 1, revision: 1 }, reason: 'Benchmark page lookups and revision lists (every page render).' },
  { collection: 'pages', name: 'githubID_1_published_-1', keys: { githubID: 1, published: -1 }, reason: '/u/[id] author pages, admin user detail, ban content hiding.' },
  { collection: 'pages', name: 'visible_1_published_-1', keys: { visible: 1, published: -1 }, reason: '/latest feed, sitemaps, dashboard time-window counts.' },
  { collection: 'runs', name: 'slug_1_revision_1', keys: { slug: 1, revision: 1 }, reason: '/api/stats aggregation per benchmark.' },
  { collection: 'runs', name: 'createdAt_-1', keys: { createdAt: -1 }, reason: 'Dashboard run counts and top benchmarks by recent runs.' },
  { collection: 'analyses', name: 'codeHash_1', keys: { codeHash: 1 }, reason: 'Deep-analysis cache lookups by code hash.' },
  { collection: 'analyses', name: 'slug_1_revision_1_createdAt_-1', keys: { slug: 1, revision: 1, createdAt: -1 }, reason: 'Latest analysis snapshot for a benchmark (reports, analysis GET).' },
  { collection: 'reports', name: 'id_1', keys: { id: 1 }, reason: '/r/[id] report lookups.' },
]

function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k, i) => bk[i] === k && Number(a[k]) === Number(b[k]))
}

export async function checkRecommendedIndexes(): Promise<IndexCheck[]> {
  const db = await getDatabase()
  const byCollection = new Map<string, Array<Record<string, unknown>>>()
  for (const spec of RECOMMENDED_INDEXES) {
    if (byCollection.has(spec.collection)) continue
    const name = spec.collection === 'pages' ? (process.env.MONGODB_COLLECTION || 'pages') : spec.collection
    const indexes = await safe(`indexes:${spec.collection}`, () => db.collection(name).indexes())
    byCollection.set(spec.collection, (indexes as Array<Record<string, unknown>> | null) || [])
  }
  return RECOMMENDED_INDEXES.map((spec) => {
    const existing = byCollection.get(spec.collection) || []
    const present = existing.some((idx) => sameKeys((idx.key as Record<string, unknown>) || {}, spec.keys))
    return { ...spec, present }
  })
}

export async function createRecommendedIndexes(): Promise<Array<{ collection: string; name: string; created: boolean; error?: string }>> {
  const db = await getDatabase()
  const status = await checkRecommendedIndexes()
  const results: Array<{ collection: string; name: string; created: boolean; error?: string }> = []
  for (const spec of status) {
    if (spec.present) {
      results.push({ collection: spec.collection, name: spec.name, created: false })
      continue
    }
    const name = spec.collection === 'pages' ? (process.env.MONGODB_COLLECTION || 'pages') : spec.collection
    try {
      await db.collection(name).createIndex(spec.keys, { name: spec.name, background: true })
      results.push({ collection: spec.collection, name: spec.name, created: true })
    } catch (err) {
      results.push({ collection: spec.collection, name: spec.name, created: false, error: (err as Error)?.message || String(err) })
    }
  }
  return results
}

export async function computeAdminStats() {
  const [pages, runs, analyses, multiRuntime, reports, users, ipBans, errors] = await Promise.all([
    pagesCollection(), runsCollection(), analysesCollection(), multiRuntimeAnalysesCollection(),
    reportsCollection(), usersCollection(), ipBansCollection(), errorsCollection(),
  ])
  const opts = { maxTimeMS: QUERY_TIMEOUT_MS }

  const [
    pagesTotal, pages24h, pages7d, pages30d, pagesHidden,
    runsTotal, runs24h, runs7d,
    analysesTotal, multiRuntimeTotal, reportsTotal,
    usersTotal, users7d, usersBanned, usersGranted, usersAdmins, ipBansTotal,
    errorsOpen, errors24h,
    donorSessions, donorEmailHits,
    topBenchmarks, recentUsers, recentAudit, indexes,
  ] = await Promise.all([
    safe('pages.total', () => pages.estimatedDocumentCount()),
    safe('pages.24h', () => pages.countDocuments({ published: { $gte: since(1) } }, opts)),
    safe('pages.7d', () => pages.countDocuments({ published: { $gte: since(7) } }, opts)),
    safe('pages.30d', () => pages.countDocuments({ published: { $gte: since(30) } }, opts)),
    safe('pages.hidden', () => pages.countDocuments({ visible: false, published: { $gte: since(30) } }, opts)),
    safe('runs.total', () => runs.estimatedDocumentCount()),
    safe('runs.24h', () => runs.countDocuments({ createdAt: { $gte: since(1) } }, opts)),
    safe('runs.7d', () => runs.countDocuments({ createdAt: { $gte: since(7) } }, opts)),
    safe('analyses.total', () => analyses.estimatedDocumentCount()),
    safe('multiRuntime.total', () => multiRuntime.estimatedDocumentCount()),
    safe('reports.total', () => reports.estimatedDocumentCount()),
    safe('users.total', () => users.estimatedDocumentCount()),
    safe('users.7d', () => users.countDocuments({ lastSeenAt: { $gte: since(7) }, source: 'signin' }, opts)),
    safe('users.banned', () => users.countDocuments({ ban: { $ne: null } }, opts)),
    safe('users.granted', () => users.countDocuments({ 'donorGrant.expiresAt': { $gt: new Date().toISOString() } }, opts)),
    safe('users.admins', () => users.countDocuments({ role: 'admin' }, opts)),
    safe('ipBans.total', () => ipBans.estimatedDocumentCount()),
    safe('errors.open', () => errors.countDocuments({ resolvedAt: null }, opts)),
    safe('errors.24h', () => errorSummary(DAY)),
    safe('redis.donorSessions', () => countRedisKeys('donor:session:*')),
    safe('redis.donorEmailHits', () => countRedisKeys('donor:email:*')),
    safe('runs.top', async () => {
      const rows = await runs.aggregate([
        { $match: { createdAt: { $gte: since(7) } } },
        { $group: { _id: { slug: '$slug', revision: '$revision' }, runs: { $sum: 1 }, lastRunAt: { $max: '$createdAt' } } },
        { $sort: { runs: -1 } },
        { $limit: 10 },
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray()
      const slugs = rows.map((r) => r._id.slug)
      const titles = slugs.length
        ? await pages.find({ slug: { $in: slugs } }, { projection: { slug: 1, revision: 1, title: 1, githubID: 1 } }).toArray()
        : []
      return rows.map((r) => {
        const page = titles.find((p) => p.slug === r._id.slug && p.revision === r._id.revision) || titles.find((p) => p.slug === r._id.slug)
        return { slug: r._id.slug, revision: r._id.revision, runs: r.runs, lastRunAt: r.lastRunAt, title: page?.title || null, githubID: page?.githubID || null }
      })
    }),
    safe('users.recent', () => users.find({ source: 'signin' }, { projection: { _id: 0, githubId: 1, login: 1, name: 1, email: 1, image: 1, lastSeenAt: 1, signInCount: 1, ban: 1, donorGrant: 1, role: 1 } }).sort({ lastSeenAt: -1 }).limit(8).toArray()),
    safe('audit.recent', () => listAudit({ limit: 10 })),
    safe('indexes', () => checkRecommendedIndexes()),
  ])

  const mem = process.memoryUsage()
  return {
    generatedAt: new Date().toISOString(),
    content: {
      pagesTotal, pages24h, pages7d, pages30d, pagesHidden30d: pagesHidden,
      runsTotal, runs24h, runs7d,
      analysesTotal, multiRuntimeTotal, reportsTotal,
    },
    users: { total: usersTotal, active7d: users7d, banned: usersBanned, granted: usersGranted, admins: usersAdmins, ipBans: ipBansTotal },
    donors: {
      activeSessions: donorSessions?.count ?? null,
      activeSessionsComplete: donorSessions?.complete ?? false,
      emailMatches: donorEmailHits?.count ?? null,
    },
    errors: { openGroups: errorsOpen, last24h: errors24h || [] },
    topBenchmarks: topBenchmarks || [],
    recentUsers: recentUsers || [],
    recentAudit: recentAudit || [],
    indexes: indexes || [],
    system: {
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      region: process.env.VERCEL_REGION || null,
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
      integrations: {
        githubOAuth: Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET),
        nextAuthSecret: Boolean(process.env.NEXTAUTH_SECRET),
        donatello: Boolean(process.env.DONATELLO_TOKEN),
        worker: Boolean(process.env.BENCHMARK_WORKER_URL),
        revalidateSecret: Boolean(process.env.REVALIDATE_SECRET),
        adminAllowlist: Boolean(process.env.ADMIN_GITHUB_IDS || process.env.ADMIN_GITHUB_LOGINS),
      },
    },
  }
}

export type AdminStats = Awaited<ReturnType<typeof computeAdminStats>>

export async function getAdminStats({ fresh = false }: { fresh?: boolean } = {}): Promise<AdminStats> {
  if (!fresh) {
    try {
      const cached = await redis.get<AdminStats | string>(CACHE_KEY)
      if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached
    } catch (_) { /* fall through */ }
  }
  const stats = await computeAdminStats()
  try { await redis.set(CACHE_KEY, JSON.stringify(stats), { ex: CACHE_TTL_SECONDS }) } catch (_) { /* non-fatal */ }
  return stats
}
