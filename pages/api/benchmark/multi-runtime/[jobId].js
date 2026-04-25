/**
 * Browser-facing polling endpoint for an asynchronous multi-runtime job.
 *
 * The browser polls this endpoint every ~1.5s after /api/benchmark/analyze
 * returns. We proxy through to the worker (using the server-side shared
 * secret which never leaves the Vercel function) and:
 *   - Shape the response to the runtimeComparison schema the UI expects
 *   - Cache successful results in Redis keyed by codeHash so repeat
 *     visits from the same code don't re-hit the worker
 *
 * Returns:
 *   200 { state: 'pending' | 'running', partial?: {...} }
 *   200 { state: 'done', runtimes: {...}, runtimeComparison: {...} }
 *   200 { state: 'errored', error: string }
 *   404 { error: 'Unknown job' }
 *   503 { error: 'Worker unreachable' }
 */

import { redis } from '../../../../lib/redis'
import { getMultiRuntimeJob } from '../../../../lib/engines/multiruntime'
import { buildRuntimeComparison } from '../../../../lib/prediction/model'

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

  const codeHash = typeof req.query.codeHash === 'string' ? req.query.codeHash : null

  // Fast path: if we've cached a "done" MR result for this codeHash,
  // serve it without bothering the worker. The cache key is per-test
  // (testIndex is in the body) — we cache the whole bundle keyed by
  // codeHash + testIndex.
  const testIndex = Number.parseInt(req.query.testIndex, 10)
  if (codeHash && Number.isFinite(testIndex)) {
    try {
      const cached = await redis.get(`mr_v2:${codeHash}:${testIndex}`)
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached
        res.setHeader('X-MR-Cache', 'HIT')
        return res.status(200).json({ state: 'done', ...parsed })
      }
    } catch (_) { /* non-fatal */ }
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

  if (codeHash && Number.isFinite(testIndex) && runtimeComparison?.available) {
    try {
      await redis.setex(`mr_v2:${codeHash}:${testIndex}`, 3600, JSON.stringify(payload))
    } catch (_) { /* non-fatal */ }
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
