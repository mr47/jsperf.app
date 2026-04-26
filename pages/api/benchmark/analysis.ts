// @ts-nocheck
/**
 * GET /api/benchmark/analysis?slug=<slug>&revision=<n>
 *
 * Returns the most recent persisted deep-analysis snapshot for a given
 * benchmark revision so the page can show analysis results immediately
 * without having to spend ~30s re-running QuickJS + V8 every time.
 *
 * The user can always force a fresh run via POST /api/benchmark/analyze
 * with `force: true`, which the "Re-analyze" button does.
 *
 * As a freshness sanity check, callers can pass `codeHash` — if the
 * latest stored snapshot was produced from a different code hash (i.e.
 * the snippet text changed) we treat the cache as stale and respond 404
 * so the client falls back to a fresh run.
 *
 * Responses:
 *   200 { analysis, codeHash, createdAt, multiRuntime? }
 *   404 { error: 'No cached analysis' }
 */
import { analysesCollection } from '../../../lib/mongodb'
import { loadStoredMultiRuntimeResults } from '../../../lib/multiRuntimeResults'

export const config = {
  maxDuration: 10,
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { slug, revision, codeHash } = req.query
  if (!slug || revision == null) {
    return res.status(400).json({ error: 'slug and revision are required' })
  }

  const rev = parseInt(revision, 10)
  if (!Number.isFinite(rev) || rev < 1) {
    return res.status(400).json({ error: 'invalid revision' })
  }

  try {
    const analyses = await analysesCollection()
    const doc = await analyses.findOne(
      { slug: String(slug), revision: rev, hasErrors: { $ne: true } },
      { sort: { createdAt: -1 } },
    )

    if (!doc) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(404).json({ error: 'No cached analysis' })
    }

    // Code drift guard: if the caller knows the current codeHash and it
    // differs from what's stored, the snippet has been edited since the
    // snapshot was taken — let the client run fresh.
    if (codeHash && doc.codeHash && String(codeHash) !== String(doc.codeHash)) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(404).json({ error: 'Stored analysis is for a different code hash' })
    }

    // Opportunistically pick up any per-test multi-runtime data from durable
    // storage. MR uses a separate key because selected Node/Deno/Bun versions
    // affect the result independently from the base QuickJS/V8 analysis hash.
    const multiRuntime = await loadStoredMultiRuntimeResults(
      doc.multiRuntimeCacheKey || doc.codeHash,
      doc.results,
    )

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      analysis: {
        results: doc.results,
        comparison: doc.comparison,
        hasErrors: doc.hasErrors || false,
        meta: doc.meta || null,
        doctor: doc.doctor || null,
      },
      codeHash: doc.codeHash || null,
      multiRuntimeCacheKey: doc.multiRuntimeCacheKey || null,
      createdAt: doc.createdAt,
      multiRuntime,
    })
  } catch (err) {
    console.error('analysis cache fetch failed:', err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

