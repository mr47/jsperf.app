/**
 * Create an index on slug, revision for fast aggregation of stats.
 */

db.runs.createIndex({
  slug: 1,
  revision: 1
})
