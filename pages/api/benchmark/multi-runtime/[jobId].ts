/**
 * Browser-facing polling endpoint for an asynchronous multi-runtime job.
 *
 * The browser polls this endpoint every ~1.5s after /api/benchmark/analyze
 * returns. We proxy through to the worker (using the server-side shared
 * secret which never leaves the Vercel function) and:
 *   - Shape the response to the runtimeComparison schema the UI expects
 *   - Store successful results in MongoDB keyed by the multi-runtime
 *     cache key so repeat visits don't re-hit the worker
 *
 * Returns:
 *   200 { state: 'pending' | 'running', partial?: {...} }
 *   200 { state: 'done', runtimes: {...}, runtimeComparison: {...} }
 *   200 { state: 'errored', error: string }
 *   404 { error: 'Unknown job' }
 *   503 { error: 'Worker unreachable' }
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { getShapedMultiRuntimeJob } from '../../../../lib/multiRuntimeJobResult'

// Polling endpoint is intentionally tiny — it should always finish well
// inside any timeout. Hobby's 60s default is fine.
export const config = {
  maxDuration: 30,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const jobId = Array.isArray(req.query.jobId) ? req.query.jobId[0] : req.query.jobId
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required' })
  }

  // Kept as `codeHash` in the public query string for compatibility with the
  // existing client, but the value is the multi-runtime cache key emitted by
  // /api/benchmark/analyze.
  const cacheKey = typeof req.query.codeHash === 'string' ? req.query.codeHash : null

  const testIndexRaw = Array.isArray(req.query.testIndex) ? req.query.testIndex[0] : req.query.testIndex
  const testIndex = Number.parseInt(testIndexRaw || '', 10)
  try {
    const result = await getShapedMultiRuntimeJob(jobId, {
      cacheKey,
      testIndex,
    })
    if (result.storeHit) res.setHeader('X-MR-Store', 'HIT')
    return res.status(result.status || 200).json(result.payload)
  } catch (err) {
    return res.status(503).json({ error: `Worker error: ${err.message || String(err)}` })
  }
}
