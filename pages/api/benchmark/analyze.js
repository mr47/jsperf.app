import { analysesCollection } from '../../../lib/mongodb'
import { redis } from '../../../lib/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { runAnalysis } from '../../../lib/engines/runner'
import { enqueueMultiRuntimeJob } from '../../../lib/engines/multiruntime'
import crypto from 'crypto'

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(2, '1 m'),
  analytics: true,
})

// Next.js requires segment config to be statically analyzable, so this
// has to be a literal — no env-conditional expression. 60s is the Hobby
// plan ceiling; we deliberately stay inside it by NOT running multi-runtime
// inline. The multi-runtime worker is enqueued asynchronously and the
// browser polls /api/benchmark/multi-runtime/[jobId] for results, so the
// length of the worker run does not contribute to this function's wall time.
//
// Synchronous budget:
//   - QuickJS:    4 profiles × ~1.5s ≈ 6s
//   - V8 sandbox: 4 profiles × ~5-8s ≈ 25-30s (sandbox boot dominates)
//   - Prediction: <100ms
//   - Total:      ~35s, leaving headroom for slow cold starts.
export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1'
    const { success } = await ratelimit.limit(`analyze:${ip}`)
    if (!success) {
      return res.status(429).json({ error: 'Too many requests. Deep analysis is limited to 2 per minute.' })
    }

    const { tests, setup, teardown, slug, revision } = req.body

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({ error: 'tests array is required and must not be empty' })
    }

    if (tests.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 tests per analysis' })
    }

    for (const test of tests) {
      if (!test.code || typeof test.code !== 'string') {
        return res.status(400).json({ error: 'Each test must have a non-empty code string' })
      }
    }

    // Cache by content hash. Two separate cache scopes:
    //   - analysis_v4:<hash>     base analysis (QuickJS + V8 + prediction)
    //   - mr_v1:<hash>           per-test multi-runtime results, fetched
    //                            and embedded by the polling client through
    //                            /api/benchmark/multi-runtime/[jobId]
    // We keep them separate because base and MR have very different
    // refresh cadences (base is deterministic; MR can vary with worker
    // host load) and so a stale cache in one shouldn't shadow the other.
    const codeHash = computeCodeHash(tests, setup, teardown)
    const cacheKey = `analysis_v4:${codeHash}`

    const cached = await redis.get(cacheKey)
    if (cached) {
      const cachedData = typeof cached === 'string' ? JSON.parse(cached) : cached
      // On cache HIT we still need to give the client fresh MR jobIds so
      // it can poll for new MR data (or pick up cached MR from the proxy
      // endpoint, which has its own per-hash cache).
      const mrInfo = await maybeEnqueueMultiRuntime(tests, setup, teardown, codeHash)
      const merged = mergeMultiRuntimeMeta(cachedData, mrInfo)
      res.setHeader('X-Analysis-Cache', 'HIT')
      return res.status(200).json(merged)
    }

    // Stream NDJSON progress + final result
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Analysis-Cache', 'MISS')
    res.status(200)

    const sendLine = (obj) => {
      res.write(JSON.stringify(obj) + '\n')
    }

    // Tell the client which engines are part of this run so it can render
    // the full step list immediately. 'multi-runtime' shows up as a step
    // even though it's not done by this function — the client tracks it
    // separately via polling.
    const enabledEngines = ['quickjs', 'v8']
    if (process.env.BENCHMARK_WORKER_URL) enabledEngines.push('multi-runtime')
    enabledEngines.push('prediction')
    sendLine({ type: 'pipeline', engines: enabledEngines })

    // Kick off MR jobs FIRST so they run on the worker concurrently with
    // QuickJS+V8 here. By the time we finish those phases the worker is
    // typically already done, so the client's first poll gets results.
    const mrInfo = await maybeEnqueueMultiRuntime(tests, setup, teardown, codeHash)
    if (mrInfo?.jobs) {
      sendLine({
        type: 'multi-runtime-enqueued',
        jobs: mrInfo.jobs,
        codeHash,
        deadlineMs: mrInfo.deadlineMs,
      })
    } else if (mrInfo?.error) {
      sendLine({ type: 'multi-runtime-unavailable', error: mrInfo.error })
    }

    const analysis = await runAnalysis(tests, {
      setup: setup || undefined,
      teardown: teardown || undefined,
      timeMs: 2000,
      onProgress: (step) => sendLine({ type: 'progress', ...step }),
    })

    const analyses = await analysesCollection()
    const doc = {
      codeHash,
      slug: slug ? String(slug) : null,
      revision: revision ? parseInt(revision, 10) : null,
      results: analysis.results,
      comparison: analysis.comparison,
      hasErrors: analysis.hasErrors || false,
      createdAt: new Date(),
    }
    await analyses.insertOne(doc)

    if (!analysis.hasErrors) {
      await redis.setex(cacheKey, 3600, JSON.stringify(analysis))
    }

    const final = mergeMultiRuntimeMeta(analysis, mrInfo)
    sendLine({ type: 'result', data: final })
    return res.end()
  } catch (error) {
    console.error('Analysis error:', error)

    if (res.headersSent) {
      const errMsg = error.name === 'AbortError' ? 'Analysis timed out' : 'Internal Server Error'
      res.write(JSON.stringify({ type: 'error', error: errMsg }) + '\n')
      return res.end()
    }

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out' })
    }

    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

/**
 * Enqueue one MR job per test on the remote worker. Returns:
 *   { jobs: [{ testIndex, jobId }, ...], deadlineMs }     on success
 *   { error: string }                                     when worker is
 *                                                         configured but
 *                                                         unreachable
 *   null                                                  when the worker
 *                                                         is not configured
 */
async function maybeEnqueueMultiRuntime(tests, setup, teardown, codeHash) {
  if (!process.env.BENCHMARK_WORKER_URL) return null

  const enqueues = await Promise.all(tests.map((t, i) =>
    enqueueMultiRuntimeJob(t.code, { setup, teardown, timeMs: 1500 })
      .then(res => ({ testIndex: i, res }))
      .catch(err => ({ testIndex: i, res: { unavailable: true, error: err.message || String(err) } }))
  ))

  const successes = enqueues.filter(e => e.res?.jobId)
  if (successes.length === 0) {
    const firstError = enqueues.find(e => e.res?.unavailable)?.res?.error
    return { error: firstError || 'Failed to enqueue multi-runtime jobs' }
  }

  // Cache the testIndex → jobId map so the polling proxy endpoint can
  // surface the most-recent run for this codeHash if a user refreshes
  // before the MR job completes.
  try {
    await redis.setex(
      `mr_jobs_v1:${codeHash}`,
      300,
      JSON.stringify(successes.map(s => ({ testIndex: s.testIndex, jobId: s.res.jobId }))),
    )
  } catch (_) { /* non-fatal */ }

  return {
    jobs: successes.map(s => ({ testIndex: s.testIndex, jobId: s.res.jobId })),
    deadlineMs: successes[0].res.deadlineMs,
  }
}

function mergeMultiRuntimeMeta(analysis, mrInfo) {
  if (!mrInfo) return analysis
  return {
    ...analysis,
    multiRuntime: mrInfo.jobs
      ? { jobs: mrInfo.jobs, deadlineMs: mrInfo.deadlineMs }
      : { unavailable: true, error: mrInfo.error },
  }
}

function computeCodeHash(tests, setup, teardown) {
  const content = JSON.stringify({
    tests: tests.map(t => ({ code: t.code.trim() })),
    setup: (setup || '').trim(),
    teardown: (teardown || '').trim(),
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}
