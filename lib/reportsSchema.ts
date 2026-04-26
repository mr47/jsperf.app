// @ts-nocheck
/**
 * Reports collection: donor-generated, immutable presentation
 * snapshots of a benchmark + its analyses. Apply by hand once, e.g.
 * via `mongosh` paste, the same way pages/runs/analyses schemas are
 * applied today.
 */

db.reports.createIndex({ id: 1 }, { unique: true })
db.reports.createIndex({ slug: 1, revision: 1 })
db.reports.createIndex({ 'creator.name': 1, createdAt: -1 })
db.reports.createIndex({ createdAt: -1 })

db.runCommand({
  collMod: 'reports',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'slug', 'revision', 'title', 'creator', 'benchmark', 'createdAt'],
      properties: {
        _id: {},
        id: { bsonType: 'string', minLength: 4, maxLength: 32 },
        slug: { bsonType: 'string', maxLength: 255 },
        revision: { bsonType: 'int', minimum: 1 },
        title: { bsonType: 'string', maxLength: 255 },
        theme: { bsonType: 'string', enum: ['auto', 'light', 'dark'] },
        creator: {
          bsonType: 'object',
          required: ['name'],
          properties: {
            name: { bsonType: 'string', maxLength: 255 },
            source: { bsonType: 'string' },
            email: { bsonType: ['string', 'null'] },
            boosted: { bsonType: 'bool' },
          },
        },
        benchmark: { bsonType: 'object' },
        stats: { bsonType: ['object', 'null'] },
        analysis: { bsonType: ['object', 'null'] },
        compatibilityMatrix: { bsonType: ['object', 'null'] },
        summary: { bsonType: ['object', 'null'] },
        createdAt: { bsonType: ['date', 'timestamp'] },
        views: { bsonType: ['int', 'long'] },
      },
    },
  },
})
