/**
 * jsperf.app multi-runtime benchmark worker.
 *
 * Two endpoints for invoking benchmark runs:
 *
 *   POST /api/run
 *     Synchronous, NDJSON-streamed. Caller blocks until all (runtime, profile)
 *     pairs finish. Best for local dev / debugging where you want to see live
 *     progress in your terminal. Subject to the caller's HTTP read timeout.
 *
 *   POST /api/jobs           (preferred from jsperf.app)
 *     Async. Enqueues the job, returns 202 immediately with { jobId }. The
 *     caller polls GET /api/jobs/:id until state === 'done' | 'errored'.
 *     This lets jsperf.app's /api/benchmark/analyze return inside Vercel's
 *     60s window without holding the HTTP connection open for the worker
 *     to finish — the browser polls separately.
 *
 *   GET /api/jobs/:id
 *     Returns { jobId, state, partial?, result?, error?, createdAt, completedAt? }
 *     state ∈ { pending, running, done, errored }
 *     `partial` is the in-progress accumulator so the UI can show per-runtime
 *     progress while the job is running.
 *
 * Authentication is a simple shared bearer token (BENCHMARK_WORKER_SECRET).
 * The worker only ever runs in a private network behind Dokploy's reverse
 * proxy, so this is appropriate for our threat model.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { runInContainer, checkImages } from './docker.js'
import { buildNodeScript } from './runtimes/node.js'
import { buildDenoScript } from './runtimes/deno.js'
import { buildBunScript } from './runtimes/bun.js'

const PORT = Number(process.env.PORT) || 8080
const SHARED_SECRET = process.env.BENCHMARK_WORKER_SECRET || ''
const COLLECT_PERF = process.env.COLLECT_PERF !== '0'

// How long a job lives in memory after it completes — long enough for the
// browser to poll it once or twice but not so long that we leak memory.
const JOB_RESULT_TTL_MS = 10 * 60 * 1000

// Hard ceiling on how long a single job can run before we give up. Default
// 30s is comfortably above our typical 1-profile / 3-runtime workload (~5s)
// while still well under the proxy timeouts most reverse proxies impose.
const JOB_DEADLINE_MS = Number(process.env.JOB_DEADLINE_MS) || 30_000

const SCRIPT_BUILDERS = {
  node: buildNodeScript,
  deno: buildDenoScript,
  bun: buildBunScript,
}

// Single profile by default. Callers that want a scaling sweep can pass
// their own profiles array in the request body.
const DEFAULT_PROFILES = [
  { label: '1x', resourceLevel: 1, cpus: 1.0, memMb: 512 },
]

const DEFAULT_RUNTIMES = ['node', 'deno', 'bun']
const MAX_TIME_MS = 5_000
const PER_RUN_TIMEOUT_MS = 30_000

// In-memory job store. Single-process worker → a Map is sufficient; if we
// ever scale horizontally we'd back this with Redis, but the current
// deployment is one container behind Dokploy.
const jobs = new Map()

const app = new Hono()

app.get('/health', async (c) => {
  const images = await checkImages()
  return c.json({
    status: 'ok',
    images,
    perf: COLLECT_PERF,
    jobs: { active: countByState('running') + countByState('pending'), total: jobs.size },
  })
})

app.post('/api/run', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  let body
  try { body = await c.req.json() } catch (_) {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const params = parseRunParams(body)
  if (params.error) return c.json({ error: params.error }, 400)

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      send({ type: 'start', runtimes: params.runtimes, profiles: params.profiles, timeMs: params.timeMs })

      const abortCtrl = new AbortController()
      c.req.raw.signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true })

      try {
        await runBenchmarkBatch(params, {
          signal: abortCtrl.signal,
          onProgress: (event) => send(event),
        })
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', error: err.message || String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})

app.post('/api/jobs', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  let body
  try { body = await c.req.json() } catch (_) {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const params = parseRunParams(body)
  if (params.error) return c.json({ error: params.error }, 400)

  const jobId = randomUUID()
  const job = {
    jobId,
    state: 'pending',
    createdAt: Date.now(),
    deadline: Date.now() + JOB_DEADLINE_MS,
    completedAt: null,
    params: { runtimes: params.runtimes, profiles: params.profiles, timeMs: params.timeMs },
    partial: emptyAccumulator(params.runtimes),
    result: null,
    error: null,
    abortCtrl: new AbortController(),
  }
  jobs.set(jobId, job)

  // Fire-and-forget. We deliberately don't await — the response is sent
  // immediately so the caller (jsperf.app's /api/analyze) doesn't burn its
  // own request budget waiting on us.
  void executeJob(job, params).catch(() => { /* errors captured on job */ })
  scheduleDeadline(job)

  return c.json({
    jobId,
    state: 'pending',
    statusUrl: `/api/jobs/${jobId}`,
    deadlineMs: JOB_DEADLINE_MS,
  }, 202)
})

app.get('/api/jobs/:id', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  const job = jobs.get(c.req.param('id'))
  if (!job) return c.json({ error: 'job not found' }, 404)

  return c.json(serializeJob(job))
})

app.delete('/api/jobs/:id', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  const job = jobs.get(c.req.param('id'))
  if (!job) return c.json({ error: 'job not found' }, 404)

  if (job.state === 'pending' || job.state === 'running') {
    job.abortCtrl.abort()
    finalizeJob(job, { state: 'errored', error: 'cancelled by client' })
  }
  return c.json(serializeJob(job))
})

function authorized(c) {
  if (!SHARED_SECRET) return true
  const auth = c.req.header('authorization') || ''
  return auth === `Bearer ${SHARED_SECRET}`
}

function parseRunParams(body) {
  const { code, setup, teardown } = body
  if (!code || typeof code !== 'string') {
    return { error: 'code (string) is required' }
  }
  const timeMs = Math.min(Number(body.timeMs) || 1500, MAX_TIME_MS)
  const runtimes = sanitizeRuntimes(body.runtimes) || DEFAULT_RUNTIMES
  const profiles = sanitizeProfiles(body.profiles) || DEFAULT_PROFILES
  return { code, setup, teardown, timeMs, runtimes, profiles }
}

function emptyAccumulator(runtimes) {
  const acc = {}
  for (const rt of runtimes) acc[rt] = { profiles: [], avgOpsPerSec: 0, error: null }
  return acc
}

async function runBenchmarkBatch({ code, setup, teardown, timeMs, runtimes, profiles }, { signal, onProgress, accum } = {}) {
  const accumulator = accum || emptyAccumulator(runtimes)

  for (const runtime of runtimes) {
    for (const profile of profiles) {
      if (signal?.aborted) throw new Error('aborted')

      onProgress?.({ type: 'progress', runtime, profile: profile.label, status: 'running' })

      const builder = SCRIPT_BUILDERS[runtime]
      const script = builder({ code, setup, teardown, timeMs })

      let outcome
      try {
        outcome = await runInContainer({
          runtime,
          script,
          profile,
          collectPerf: COLLECT_PERF,
          timeoutMs: PER_RUN_TIMEOUT_MS,
          signal,
        })
      } catch (err) {
        outcome = {
          result: { state: 'errored', error: err.message || String(err), opsPerSec: 0, latency: null, memory: null },
          perfCounters: null,
          durationMs: 0,
          exitCode: -1,
          stderrTail: '',
        }
      }

      const profileResult = {
        label: profile.label,
        resourceLevel: profile.resourceLevel,
        cpus: profile.cpus,
        memMb: profile.memMb,
        durationMs: outcome.durationMs,
        exitCode: outcome.exitCode,
        perfCounters: outcome.perfCounters,
        stderrTail: outcome.result.state === 'errored' ? outcome.stderrTail : undefined,
        ...outcome.result,
      }
      accumulator[runtime].profiles.push(profileResult)
      if (profileResult.state === 'errored' && !accumulator[runtime].error) {
        accumulator[runtime].error = profileResult.error || 'unknown error'
      }

      onProgress?.({ type: 'result', runtime, profile: profile.label, ...profileResult })
    }
  }

  for (const rt of runtimes) {
    const ops = accumulator[rt].profiles.map(p => p.opsPerSec).filter(n => n > 0)
    accumulator[rt].avgOpsPerSec = ops.length > 0
      ? Math.round(ops.reduce((s, v) => s + v, 0) / ops.length)
      : 0
  }

  return accumulator
}

async function executeJob(job, params) {
  job.state = 'running'

  try {
    const result = await runBenchmarkBatch(params, {
      signal: job.abortCtrl.signal,
      accum: job.partial,
      // partial is updated in-place by runBenchmarkBatch via accumulator;
      // no separate onProgress wiring needed for the polling client.
    })
    finalizeJob(job, { state: 'done', result: { runtimes: result } })
  } catch (err) {
    if (job.state === 'errored') return // already finalized by deadline / cancel
    finalizeJob(job, { state: 'errored', error: err.message || String(err) })
  }
}

function finalizeJob(job, { state, result = null, error = null }) {
  if (job.completedAt) return
  job.state = state
  job.result = result
  job.error = error
  job.completedAt = Date.now()
  // Schedule TTL eviction
  setTimeout(() => jobs.delete(job.jobId), JOB_RESULT_TTL_MS).unref?.()
}

function scheduleDeadline(job) {
  setTimeout(() => {
    if (!job.completedAt) {
      job.abortCtrl.abort()
      finalizeJob(job, { state: 'errored', error: `job exceeded deadline of ${JOB_DEADLINE_MS}ms` })
    }
  }, JOB_DEADLINE_MS).unref?.()
}

function serializeJob(job) {
  return {
    jobId: job.jobId,
    state: job.state,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    deadline: job.deadline,
    partial: job.state === 'running' ? job.partial : undefined,
    result: job.result,
    error: job.error,
  }
}

function countByState(state) {
  let n = 0
  for (const j of jobs.values()) if (j.state === state) n++
  return n
}

function sanitizeRuntimes(input) {
  if (!Array.isArray(input)) return null
  const allowed = input.filter(r => SCRIPT_BUILDERS[r])
  return allowed.length > 0 ? allowed : null
}

function sanitizeProfiles(input) {
  if (!Array.isArray(input)) return null
  const cleaned = input
    .map(p => ({
      label: String(p.label || ''),
      resourceLevel: Number(p.resourceLevel) || 1,
      cpus: Math.max(0.1, Math.min(8, Number(p.cpus) || 1)),
      memMb: Math.max(64, Math.min(8192, Number(p.memMb) || 256)),
    }))
    .filter(p => p.label)
  return cleaned.length > 0 ? cleaned : null
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`jsperf-worker listening on :${info.port}`)
  if (!SHARED_SECRET) {
    console.warn('WARNING: BENCHMARK_WORKER_SECRET not set — endpoints are unauthenticated')
  }
})
