import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
const options = {
  useUnifiedTopology: true,
  useNewUrlParser: true,
}

let client
let clientPromise

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

  return db.collection('multiRuntimeAnalyses')
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
