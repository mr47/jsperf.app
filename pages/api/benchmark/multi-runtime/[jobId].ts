// @ts-nocheck
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

import { getMultiRuntimeJob } from '../../../../lib/engines/multiruntime'
import { buildRuntimeComparison } from '../../../../lib/prediction/model'
import {
  loadStoredMultiRuntimeResults,
  persistMultiRuntimeResult,
} from '../../../../lib/multiRuntimeResults'

// Polling endpoint is intentionally tiny — it should always finish well
// inside any timeout. Hobby's 60s default is fine.
export const config = {
  maxDuration: 30,
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const { jobId } = req.query
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required' })
  }

  // Kept as `codeHash` in the public query string for compatibility with the
  // existing client, but the value is the multi-runtime cache key emitted by
  // /api/benchmark/analyze.
  const cacheKey = typeof req.query.codeHash === 'string' ? req.query.codeHash : null

  // Fast path: if we've already stored a "done" MR result for this key,
  // serve it without bothering the worker.
  const testIndex = Number.parseInt(req.query.testIndex, 10)
  if (cacheKey && Number.isFinite(testIndex)) {
    try {
      const stored = await loadStoredMultiRuntimeResults(cacheKey, [{ testIndex }], { requireAll: true })
      const storedResult = stored?.results?.[0]
      if (storedResult) {
        res.setHeader('X-MR-Store', 'HIT')
        return res.status(200).json({
          state: 'done',
          runtimes: storedResult.runtimes,
          runtimeComparison: storedResult.runtimeComparison,
        })
      }
    } catch (err) {
      console.warn('multi-runtime store read failed:', err?.message || err)
    }
  }

  let job
  try {
    job = await getMultiRuntimeJob(jobId)
  } catch (err) {
    return res.status(503).json({ error: `Worker error: ${err.message || String(err)}` })
  }

  if (job === null) return res.status(404).json({ error: 'Unknown job' })
  if (job.unavailable) return res.status(503).json({ error: job.error })

  if (job.state === 'errored') {
    return res.status(200).json({ state: 'errored', error: job.error || 'unknown error' })
  }

  if (job.state === 'pending' || job.state === 'running') {
    return res.status(200).json({
      state: job.state,
      partial: shapePartial(job.partial),
    })
  }

  // state === 'done' — shape into the runtimeComparison schema the UI
  // already knows how to render.
  const runtimes = job.result?.runtimes || {}
  const runtimeComparison = buildRuntimeComparison(runtimes)
  const payload = { runtimes, runtimeComparison }

  if (cacheKey && Number.isFinite(testIndex) && runtimeComparison?.available) {
    try {
      await persistMultiRuntimeResult({
        cacheKey,
        testIndex,
        runtimes,
        runtimeComparison,
      })
    } catch (err) {
      console.warn('multi-runtime store write failed:', err?.message || err)
    }
  }

  return res.status(200).json({ state: 'done', ...payload })
}

// Trim the worker's in-memory accumulator down to what the UI actually
// shows during the "running" state — currently just per-runtime progress
// counts so we can drive a partial spinner.
function shapePartial(partial) {
  if (!partial) return null
  const out = {}
  for (const [runtime, data] of Object.entries(partial)) {
    out[runtime] = {
      profilesCompleted: (data.profiles || []).length,
      hasError: Boolean(data.error),
    }
  }
  return out
}
