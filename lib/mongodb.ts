// @ts-nocheck
import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
const options = {
  useUnifiedTopology: true,
  useNewUrlParser: true,
}

let client
let clientPromise
let multiRuntimeAnalysesReadyPromise
let cpuProfilesReadyPromise
let jitArtifactsReadyPromise
let promoCodesReadyPromise

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your Mongo URI to .env.local')
}

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options)
    global._mongoClientPromise = client.connect()
  }
  clientPromise = global._mongoClientPromise
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options)
  clientPromise = client.connect()
}

/**
 * Indexes the hot read/write paths rely on. This is the single source of
 * truth: the collection accessors below kick off creation lazily (once per
 * process, in the background, never blocking a request), and the admin
 * dashboard uses the same list to report anything still missing.
 *
 * `collection: 'pages'` resolves to MONGODB_COLLECTION at runtime.
 */
export const CORE_INDEXES = [
  { collection: 'pages', name: 'slug_1_revision_1', keys: { slug: 1, revision: 1 }, options: { unique: true }, reason: 'Benchmark page lookups and revision lists (every page render). Unique so concurrent saves cannot produce duplicate revisions.' },
  { collection: 'pages', name: 'githubID_1_published_-1', keys: { githubID: 1, published: -1 }, options: {}, reason: '/u/[id] author pages, admin user detail, ban content hiding.' },
  { collection: 'pages', name: 'visible_1_published_-1', keys: { visible: 1, published: -1 }, options: {}, reason: '/latest feed, sitemaps, dashboard time-window counts.' },
  { collection: 'runs', name: 'slug_1_revision_1', keys: { slug: 1, revision: 1 }, options: {}, reason: '/api/stats aggregation per benchmark.' },
  { collection: 'runs', name: 'createdAt_-1', keys: { createdAt: -1 }, options: {}, reason: 'Dashboard run counts and top benchmarks by recent runs.' },
  { collection: 'analyses', name: 'codeHash_1', keys: { codeHash: 1 }, options: {}, reason: 'Deep-analysis cache lookups by code hash.' },
  { collection: 'analyses', name: 'slug_1_revision_1_createdAt_-1', keys: { slug: 1, revision: 1, createdAt: -1 }, options: {}, reason: 'Latest analysis snapshot for a benchmark (reports, analysis GET).' },
  { collection: 'reports', name: 'id_1', keys: { id: 1 }, options: {}, reason: '/r/[id] report lookups.' },
]

export function resolveCollectionName(logicalName) {
  return logicalName === 'pages' ? (process.env.MONGODB_COLLECTION || 'pages') : logicalName
}

const CORE_INDEX_RETRY_MS = 10 * 60 * 1000
const coreIndexState = {}

/**
 * Fire-and-forget index creation for one logical collection. Failures are
 * logged and retried later rather than surfaced, so a bad index (e.g. a
 * unique index over legacy duplicates) can never take the site down —
 * the admin dashboard shows what is still missing.
 */
function ensureCoreIndexes(db, logicalName) {
  const state = coreIndexState[logicalName]
  if (state?.done || (state?.attemptedAt && Date.now() - state.attemptedAt < CORE_INDEX_RETRY_MS)) return
  coreIndexState[logicalName] = { attemptedAt: Date.now(), done: false }

  const collection = db.collection(resolveCollectionName(logicalName))
  const specs = CORE_INDEXES.filter((spec) => spec.collection === logicalName)
  void (async () => {
    let allOk = true
    for (const spec of specs) {
      try {
        await collection.createIndex(spec.keys, { name: spec.name, background: true, ...spec.options })
      } catch (err) {
        allOk = false
        console.warn(`[mongodb] could not create index ${logicalName}.${spec.name}: ${err?.message || err}`)
      }
    }
    if (allOk) coreIndexState[logicalName].done = true
  })()
}

export const pagesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  ensureCoreIndexes(db, 'pages')

  return db.collection(process.env.MONGODB_COLLECTION)
}

export const runsCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  ensureCoreIndexes(db, 'runs')

  return db.collection('runs')
}

export const analysesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  ensureCoreIndexes(db, 'analyses')

  return db.collection('analyses')
}

export const multiRuntimeAnalysesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  await ensureMultiRuntimeAnalyses(db)

  return db.collection('multiRuntimeAnalyses')
}

export const cpuProfilesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  await ensureCpuProfiles(db)

  return db.collection('cpuProfiles')
}

export const jitArtifactsCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  await ensureJitArtifacts(db)

  return db.collection('jitArtifacts')
}

export const promoCodesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  await ensurePromoCodes(db)

  return db.collection('promoCodes')
}

async function ensureMultiRuntimeAnalyses(db) {
  if (!multiRuntimeAnalysesReadyPromise) {
    multiRuntimeAnalysesReadyPromise = (async () => {
      try {
        await db.createCollection('multiRuntimeAnalyses')
      } catch (err) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') throw err
      }

      const collection = db.collection('multiRuntimeAnalyses')
      await collection.createIndex(
        { multiRuntimeCacheKey: 1, testIndex: 1 },
        { unique: true, name: 'uniq_multiRuntimeCacheKey_testIndex' },
      )
      await collection.createIndex(
        { updatedAt: -1 },
        { name: 'updatedAt_desc' },
      )
    })().catch((err) => {
      multiRuntimeAnalysesReadyPromise = null
      throw err
    })
  }

  return multiRuntimeAnalysesReadyPromise
}

async function ensureCpuProfiles(db) {
  if (!cpuProfilesReadyPromise) {
    cpuProfilesReadyPromise = (async () => {
      try {
        await db.createCollection('cpuProfiles')
      } catch (err) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') throw err
      }

      const collection = db.collection('cpuProfiles')
      await collection.createIndex(
        { id: 1 },
        { unique: true, name: 'uniq_cpu_profile_id' },
      )
      await collection.createIndex(
        { multiRuntimeCacheKey: 1, testIndex: 1, runtime: 1 },
        { name: 'cpu_profile_lookup' },
      )
      await collection.createIndex(
        { updatedAt: -1 },
        { name: 'cpu_profile_updatedAt_desc' },
      )
    })().catch((err) => {
      cpuProfilesReadyPromise = null
      throw err
    })
  }

  return cpuProfilesReadyPromise
}

async function ensureJitArtifacts(db) {
  if (!jitArtifactsReadyPromise) {
    jitArtifactsReadyPromise = (async () => {
      try {
        await db.createCollection('jitArtifacts')
      } catch (err) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') throw err
      }

      const collection = db.collection('jitArtifacts')
      await collection.createIndex(
        { id: 1 },
        { unique: true, name: 'uniq_jit_artifact_id' },
      )
      await collection.createIndex(
        { multiRuntimeCacheKey: 1, testIndex: 1, runtime: 1 },
        { name: 'jit_artifact_lookup' },
      )
      await collection.createIndex(
        { updatedAt: -1 },
        { name: 'jit_artifact_updatedAt_desc' },
      )
    })().catch((err) => {
      jitArtifactsReadyPromise = null
      throw err
    })
  }

  return jitArtifactsReadyPromise
}

async function ensurePromoCodes(db) {
  if (!promoCodesReadyPromise) {
    promoCodesReadyPromise = (async () => {
      try {
        await db.createCollection('promoCodes')
      } catch (err) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') throw err
      }

      const collection = db.collection('promoCodes')
      await collection.createIndex(
        { type: 1, code: 1 },
        {
          unique: true,
          name: 'uniq_promo_code',
          partialFilterExpression: { type: 'code' },
        },
      )
      await collection.createIndex(
        { type: 1, code: 1, email: 1 },
        {
          unique: true,
          name: 'uniq_promo_redemption_email',
          partialFilterExpression: { type: 'redemption' },
        },
      )
      await collection.createIndex(
        { type: 1, expiresAt: 1 },
        { name: 'promo_redemption_expiresAt' },
      )
    })().catch((err) => {
      promoCodesReadyPromise = null
      throw err
    })
  }

  return promoCodesReadyPromise
}

/**
 * Donor-generated presentation reports. Each document is an immutable
 * snapshot of a benchmark + its run / analysis data at the moment the
 * donor pressed "Generate report", so links keep working even after
 * the underlying benchmark is updated or the analysis cache rotates.
 *
 * Schema (see also lib/reportsSchema.js):
 *   id          string   short, URL-safe, unique
 *   slug        string   source benchmark slug
 *   revision    int      source benchmark revision
 *   title       string
 *   theme       string   'auto' | 'light' | 'dark'
 *   creator     object   { name, source, email? }   donor identity
 *   benchmark   object   page snapshot (title, tests, setup, teardown, ...)
 *   stats       object   per-test browser breakdown (snapshot of /api/stats)
 *   analysis    object?  deep-analysis snapshot if the donor had it
 *   summary     object   pre-computed leader, lagger, speed-up, etc.
 *   createdAt   Date
 *   views       int
 */
export const reportsCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  ensureCoreIndexes(db, 'reports')

  return db.collection('reports')
}

/**
 * Admin-panel collections. Indexes are created lazily on first access
 * (idempotent; MongoDB builds them in the background).
 *
 *   users       one document per GitHub identity that has signed in (or
 *               was backfilled from `pages.githubID`). Holds ban, admin
 *               role and admin-granted donor boost.
 *   ipBans      IP-level bans for anonymous abusers (create is unauthenticated).
 *   errors      server/client error log, grouped by fingerprint + hour bucket,
 *               auto-expired after 30 days.
 *   adminAudit  append-only log of admin actions.
 */
const adminCollectionsReady = {}

async function ensureIndexedCollection(db, name, indexes) {
  if (!adminCollectionsReady[name]) {
    adminCollectionsReady[name] = (async () => {
      try {
        await db.createCollection(name)
      } catch (err) {
        if (err?.code !== 48 && err?.codeName !== 'NamespaceExists') throw err
      }
      const collection = db.collection(name)
      for (const [keys, options] of indexes) {
        await collection.createIndex(keys, options)
      }
    })().catch((err) => {
      adminCollectionsReady[name] = null
      throw err
    })
  }
  return adminCollectionsReady[name]
}

export const usersCollection = async function() {
  const client = await clientPromise
  const db = client.db('jsperf')
  await ensureIndexedCollection(db, 'users', [
    [{ githubId: 1 }, { unique: true, name: 'uniq_users_githubId' }],
    [{ login: 1 }, { name: 'users_login' }],
    [{ email: 1 }, { name: 'users_email', sparse: true }],
    [{ lastSeenAt: -1 }, { name: 'users_lastSeenAt_desc' }],
    [{ 'ban.at': -1 }, { name: 'users_ban_at', sparse: true }],
    [{ 'donorGrant.expiresAt': 1 }, { name: 'users_donorGrant_expiresAt', sparse: true }],
  ])
  return db.collection('users')
}

export const ipBansCollection = async function() {
  const client = await clientPromise
  const db = client.db('jsperf')
  await ensureIndexedCollection(db, 'ipBans', [
    [{ ip: 1 }, { unique: true, name: 'uniq_ipBans_ip' }],
    [{ at: -1 }, { name: 'ipBans_at_desc' }],
  ])
  return db.collection('ipBans')
}

export const errorsCollection = async function() {
  const client = await clientPromise
  const db = client.db('jsperf')
  await ensureIndexedCollection(db, 'errors', [
    [{ fingerprint: 1, bucket: 1 }, { unique: true, name: 'uniq_errors_fingerprint_bucket' }],
    [{ lastSeenAt: -1 }, { name: 'errors_lastSeenAt_desc' }],
    [{ scope: 1, lastSeenAt: -1 }, { name: 'errors_scope_lastSeenAt' }],
    [{ lastSeenAt: 1 }, { name: 'errors_ttl', expireAfterSeconds: 60 * 60 * 24 * 30 }],
  ])
  return db.collection('errors')
}

export const adminAuditCollection = async function() {
  const client = await clientPromise
  const db = client.db('jsperf')
  await ensureIndexedCollection(db, 'adminAudit', [
    [{ createdAt: -1 }, { name: 'adminAudit_createdAt_desc' }],
    [{ targetType: 1, targetId: 1, createdAt: -1 }, { name: 'adminAudit_target' }],
  ])
  return db.collection('adminAudit')
}

/** Raw database handle for admin maintenance (index inspection etc.). */
export const getDatabase = async function() {
  const client = await clientPromise
  return client.db('jsperf')
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise
