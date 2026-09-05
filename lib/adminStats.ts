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
  CORE_INDEXES,
  analysesCollection,
  errorsCollection,
  getDatabase,
  ipBansCollection,
  multiRuntimeAnalysesCollection,
  pagesCollection,
  reportsCollection,
  resolveCollectionName,
  runsCollection,
  usersCollection,
} from './mongodb'
import { errorSummary } from './errorLog'
import { listAudit, type BanRecord, type DonorGrant } from './users'

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
  options: Record<string, unknown>
  present: boolean
  reason: string
}

/**
 * The core collection accessors create these lazily in the background; the
 * dashboard reports anything still missing (e.g. a unique index blocked by
 * legacy duplicates) and can retry creation on demand.
 */
export const RECOMMENDED_INDEXES: Array<Omit<IndexCheck, 'present'>> = CORE_INDEXES as Array<Omit<IndexCheck, 'present'>>

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
    const name = resolveCollectionName(spec.collection)
    const indexes = await safe(`indexes:${spec.collection}`, () => db.collection(name).indexes())
    byCollection.set(spec.collection, (indexes as Array<Record<string, unknown>> | null) || [])
  }
  return RECOMMENDED_INDEXES.map((spec) => {
    const existing = byCollection.get(spec.collection) || []
    const match = existing.find((idx) => sameKeys((idx.key as Record<string, unknown>) || {}, spec.keys))
    // A same-keys index that is not unique when the spec requires it does
    // not satisfy the spec (it cannot stop duplicate revisions).
    const present = !!match && (!spec.options?.unique || match.unique === true)
    return { ...spec, present }
  })
}

/** Name of an existing index with the same key pattern as `spec`, if any. */
async function findConflictingIndexName(db: Awaited<ReturnType<typeof getDatabase>>, spec: Omit<IndexCheck, 'present'>) {
  const indexes = await db.collection(resolveCollectionName(spec.collection)).indexes()
  const match = (indexes as Array<Record<string, unknown>>).find((idx) => sameKeys((idx.key as Record<string, unknown>) || {}, spec.keys))
  return match && typeof match.name === 'string' ? match.name : null
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
    const collection = db.collection(resolveCollectionName(spec.collection))
    // MongoDB refuses a second index over the same keys with different
    // options, so an existing non-unique index has to be dropped first.
    // If the unique build then fails (legacy duplicates), put the plain
    // index back so the read path does not regress.
    const conflicting = await findConflictingIndexName(db, spec)
    try {
      if (conflicting) await collection.dropIndex(conflicting)
      await collection.createIndex(spec.keys, { name: spec.name, background: true, ...spec.options })
      results.push({ collection: spec.collection, name: spec.name, created: true })
    } catch (err) {
      const message = (err as Error)?.message || String(err)
      if (conflicting) {
        try {
          await collection.createIndex(spec.keys, { name: conflicting, background: true })
        } catch (_) { /* best effort */ }
      }
      results.push({ collection: spec.collection, name: spec.name, created: false, error: message })
    }
  }
  return results
}

export type TopBenchmark = { slug: string; revision: number; runs: number; lastRunAt: Date | string; title: string | null; githubID: string | null }

export type RecentUser = {
  githubId: string
  login: string | null
  name: string | null
  email: string | null
  image: string | null
  lastSeenAt: Date | string
  signInCount: number
  role?: 'admin' | null
  ban?: BanRecord | null
  donorGrant?: DonorGrant | null
}

export type AuditRow = {
  action: string
  actorId: string
  actorLogin: string | null
  targetType: string
  targetId: string
  details: Record<string, unknown>
  createdAt: Date | string
}

export type AdminStats = {
  generatedAt: string
  content: {
    pagesTotal: number | null
    pages24h: number | null
    pages7d: number | null
    pages30d: number | null
    pagesHidden30d: number | null
    runsTotal: number | null
    runs24h: number | null
    runs7d: number | null
    analysesTotal: number | null
    multiRuntimeTotal: number | null
    reportsTotal: number | null
  }
  users: { total: number | null; active7d: number | null; banned: number | null; granted: number | null; admins: number | null; ipBans: number | null }
  donors: { activeSessions: number | null; activeSessionsComplete: boolean; emailMatches: number | null }
  errors: { openGroups: number | null; last24h: Array<{ scope: string; count: number; groups: number; lastSeenAt: Date | string }> }
  topBenchmarks: TopBenchmark[]
  recentUsers: RecentUser[]
  recentAudit: AuditRow[]
  indexes: IndexCheck[]
  system: {
    node: string
    uptimeSeconds: number
    rssMb: number
    heapUsedMb: number
    region: string | null
    env: string | null
    integrations: Record<string, boolean>
  }
}

export async function computeAdminStats(): Promise<AdminStats> {
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
    safe<number>('pages.total', () => pages.estimatedDocumentCount()),
    safe<number>('pages.24h', () => pages.countDocuments({ published: { $gte: since(1) } }, opts)),
    safe<number>('pages.7d', () => pages.countDocuments({ published: { $gte: since(7) } }, opts)),
    safe<number>('pages.30d', () => pages.countDocuments({ published: { $gte: since(30) } }, opts)),
    safe<number>('pages.hidden', () => pages.countDocuments({ visible: false, published: { $gte: since(30) } }, opts)),
    safe<number>('runs.total', () => runs.estimatedDocumentCount()),
    safe<number>('runs.24h', () => runs.countDocuments({ createdAt: { $gte: since(1) } }, opts)),
    safe<number>('runs.7d', () => runs.countDocuments({ createdAt: { $gte: since(7) } }, opts)),
    safe<number>('analyses.total', () => analyses.estimatedDocumentCount()),
    safe<number>('multiRuntime.total', () => multiRuntime.estimatedDocumentCount()),
    safe<number>('reports.total', () => reports.estimatedDocumentCount()),
    safe<number>('users.total', () => users.estimatedDocumentCount()),
    safe<number>('users.7d', () => users.countDocuments({ lastSeenAt: { $gte: since(7) }, source: 'signin' }, opts)),
    safe<number>('users.banned', () => users.countDocuments({ ban: { $ne: null } }, opts)),
    safe<number>('users.granted', () => users.countDocuments({ 'donorGrant.expiresAt': { $gt: new Date().toISOString() } }, opts)),
    safe<number>('users.admins', () => users.countDocuments({ role: 'admin' }, opts)),
    safe<number>('ipBans.total', () => ipBans.estimatedDocumentCount()),
    safe<number>('errors.open', () => errors.countDocuments({ resolvedAt: null }, opts)),
    safe('errors.24h', () => errorSummary(DAY)),
    safe('redis.donorSessions', () => countRedisKeys('donor:session:*')),
    safe('redis.donorEmailHits', () => countRedisKeys('donor:email:*')),
    safe<TopBenchmark[]>('runs.top', async () => {
      const rows: Array<{ _id: { slug: string; revision: number }; runs: number; lastRunAt: Date }> = await runs.aggregate([
        { $match: { createdAt: { $gte: since(7) } } },
        { $group: { _id: { slug: '$slug', revision: '$revision' }, runs: { $sum: 1 }, lastRunAt: { $max: '$createdAt' } } },
        { $sort: { runs: -1 } },
        { $limit: 10 },
      ], { maxTimeMS: QUERY_TIMEOUT_MS }).toArray()
      const slugs = rows.map((r) => r._id.slug)
      const titles: Array<{ slug: string; revision: number; title?: string; githubID?: string }> = slugs.length
        ? await pages.find({ slug: { $in: slugs } }, { projection: { slug: 1, revision: 1, title: 1, githubID: 1 } }).toArray()
        : []
      return rows.map((r) => {
        const page = titles.find((p) => p.slug === r._id.slug && p.revision === r._id.revision) || titles.find((p) => p.slug === r._id.slug)
        return { slug: r._id.slug, revision: r._id.revision, runs: r.runs, lastRunAt: r.lastRunAt, title: page?.title || null, githubID: page?.githubID || null }
      })
    }),
    safe<RecentUser[]>('users.recent', () => users.find({ source: 'signin' }, { projection: { _id: 0, githubId: 1, login: 1, name: 1, email: 1, image: 1, lastSeenAt: 1, signInCount: 1, ban: 1, donorGrant: 1, role: 1 } }).sort({ lastSeenAt: -1 }).limit(8).toArray()),
    safe<AuditRow[]>('audit.recent', () => listAudit({ limit: 10 }) as Promise<AuditRow[]>),
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
