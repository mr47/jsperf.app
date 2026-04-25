// @ts-nocheck
import { multiRuntimeAnalysesCollection } from './mongodb'

function testIndexFor(ref, fallbackIndex) {
  return Number.isInteger(ref?.testIndex) ? ref.testIndex : fallbackIndex
}

function shapeStoredResult(doc) {
  if (!doc) return null
  if (!doc.runtimeComparison?.available) return null
  return {
    testIndex: doc.testIndex,
    state: 'done',
    runtimes: doc.runtimes,
    runtimeComparison: doc.runtimeComparison,
  }
}

export async function loadStoredMultiRuntimeResults(cacheKey, testRefs, { requireAll = false } = {}) {
  if (!cacheKey || !Array.isArray(testRefs) || testRefs.length === 0) return null

  const testIndices = testRefs
    .map(testIndexFor)
    .filter(Number.isInteger)

  if (testIndices.length === 0) return null

  const collection = await multiRuntimeAnalysesCollection()
  const docs = await collection
    .find({
      multiRuntimeCacheKey: cacheKey,
      testIndex: { $in: testIndices },
    })
    .toArray()

  const byIndex = new Map(docs.map(doc => [doc.testIndex, doc]))
  const results = testIndices
    .map(testIndex => shapeStoredResult(byIndex.get(testIndex)))
    .filter(Boolean)

  if (requireAll && results.length !== testIndices.length) return null
  if (results.length === 0) return null

  return {
    results,
    fromStore: true,
    cacheKey,
  }
}

export async function persistMultiRuntimeResult({ cacheKey, testIndex, runtimes, runtimeComparison }) {
  if (!cacheKey || !Number.isInteger(testIndex) || !runtimeComparison?.available) return false

  const now = new Date()
  const collection = await multiRuntimeAnalysesCollection()
  await collection.updateOne(
    { multiRuntimeCacheKey: cacheKey, testIndex },
    {
      $set: {
        multiRuntimeCacheKey: cacheKey,
        testIndex,
        runtimes,
        runtimeComparison,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  )

  return true
}

export async function attachStoredMultiRuntimeResults(analysis, cacheKey) {
  if (!analysis?.results?.length || !cacheKey) return analysis

  const stored = await loadStoredMultiRuntimeResults(cacheKey, analysis.results)
  if (!stored?.results?.length) return analysis

  const byIndex = new Map(stored.results.map(result => [result.testIndex, result]))
  return {
    ...analysis,
    results: analysis.results.map(result => {
      const storedResult = byIndex.get(result.testIndex)
      if (!storedResult) return result
      return {
        ...result,
        multiRuntime: storedResult.runtimes,
        runtimeComparison: storedResult.runtimeComparison,
      }
    }),
  }
}
