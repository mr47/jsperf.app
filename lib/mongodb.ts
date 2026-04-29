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

export const pagesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')

  return db.collection(process.env.MONGODB_COLLECTION)
}

export const runsCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')

  return db.collection('runs')
}

export const analysesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')

  return db.collection('analyses')
}

export const multiRuntimeAnalysesCollection = async function() {
  const client = await clientPromise

  const db = client.db('jsperf')
  await ensureMultiRuntimeAnalyses(db)

  return db.collection('multiRuntimeAnalyses')
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

  return db.collection('reports')
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise
