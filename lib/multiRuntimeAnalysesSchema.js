/**
 * Durable Node/Deno/Bun multi-runtime analysis results.
 *
 * Apply by hand once via `mongosh` paste, matching the existing schema files.
 * Runtime code also creates the collection and indexes idempotently so local
 * and preview environments do not depend on a manual bootstrap step.
 */

if (!db.getCollectionNames().includes('multiRuntimeAnalyses')) {
  db.createCollection('multiRuntimeAnalyses')
}

db.multiRuntimeAnalyses.createIndex(
  { multiRuntimeCacheKey: 1, testIndex: 1 },
  { unique: true, name: 'uniq_multiRuntimeCacheKey_testIndex' },
)

db.multiRuntimeAnalyses.createIndex(
  { updatedAt: -1 },
  { name: 'updatedAt_desc' },
)

db.runCommand({
  collMod: 'multiRuntimeAnalyses',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['multiRuntimeCacheKey', 'testIndex', 'runtimes', 'runtimeComparison', 'createdAt', 'updatedAt'],
      properties: {
        _id: {},
        multiRuntimeCacheKey: { bsonType: 'string', minLength: 1, maxLength: 128 },
        testIndex: { bsonType: 'int', minimum: 0 },
        runtimes: { bsonType: 'object' },
        runtimeComparison: { bsonType: 'object' },
        createdAt: { bsonType: ['date', 'timestamp'] },
        updatedAt: { bsonType: ['date', 'timestamp'] },
      },
    },
  },
})
