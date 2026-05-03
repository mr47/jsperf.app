// @ts-nocheck
/**
 * jsperf.net multi-runtime benchmark worker.
 *
 * Two endpoints for invoking benchmark runs:
 *
 *   POST /api/run
 *     Synchronous, NDJSON-streamed. Caller blocks until all (runtime, profile)
 *     pairs finish. Best for local dev / debugging where you want to see live
 *     progress in your terminal. Subject to the caller's HTTP read timeout.
 *
 *   POST /api/jobs           (preferred from jsperf.net)
 *     Async. Enqueues the job, returns 202 immediately with { jobId }. The
 *     caller polls GET /api/jobs/:id until state === 'done' | 'errored'.
 *     This lets jsperf.net's /api/benchmark/analyze return inside Vercel's
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
import { runInContainer, checkImages, prepareRuntimeImages } from './docker.js'
import { buildNodeScript } from './runtimes/node.js'
import { buildDenoScript } from './runtimes/deno.js'
import { buildBunScript } from './runtimes/bun.js'
import { runQuickJSAnalysis } from './runtimes/quickjs.js'
import { DEFAULT_RUNTIME_TARGETS, normalizeRuntimeTargets } from './runtime-targets.js'
import { estimateComplexity } from './complexity/estimator.js'

const PORT = Number(process.env.PORT) || 8080
const SHARED_SECRET = process.env.BENCHMARK_WORKER_SECRET || ''
const COLLECT_PERF = process.env.COLLECT_PERF !== '0'

// How long a job lives in memory after it completes — long enough for the
// browser to poll it once or twice but not so long that we leak memory.
const JOB_RESULT_TTL_MS = 10 * 60 * 1000

// Hard ceiling on how long a single async job can run before we give up.
// When JOB_DEADLINE_MS is unset we size it from the requested runtime/profile
// matrix so first-time Docker pulls do not fail otherwise healthy jobs.
const FIXED_JOB_DEADLINE_MS = Number(process.env.JOB_DEADLINE_MS) || null
const MIN_JOB_DEADLINE_MS = 30_000
const MAX_JOB_DEADLINE_MS = Number(process.env.MAX_JOB_DEADLINE_MS) || 180_000
const VERSIONED_IMAGE_PULL_GRACE_MS = 20_000

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

  console.info('[worker] starting sync run', {
    runtimes: runtimeIds(params.runtimeTargets),
    profiles: profileLabels(params.profiles),
    timeMs: params.timeMs,
    profiling: params.profiling || null,
  })

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      send({ type: 'start', runtimes: params.runtimeTargets, profiles: params.profiles, timeMs: params.timeMs, isAsync: params.isAsync })

      const abortCtrl = new AbortController()
      c.req.raw.signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true })

      try {
        await runBenchmarkBatch(params, {
          signal: abortCtrl.signal,
          onProgress: (event) => send(event),
        })
        send({ type: 'done' })
      } catch (err) {
        console.error('[worker] sync run failed', {
          error: err.message || String(err),
        })
        send({ type: 'error', error: err.message || String(err) })
      } finally {
        console.info('[worker] sync run finished', {
          runtimes: runtimeIds(params.runtimeTargets),
          profiles: profileLabels(params.profiles),
        })
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

  const job = enqueueBenchmarkJob(params)

  return c.json({
    jobId: job.jobId,
    state: 'pending',
    statusUrl: `/api/jobs/${job.jobId}`,
    deadlineMs: job.pollDeadlineMs,
    executionDeadlineMs: job.deadlineMs,
  }, 202)
})

app.post('/api/analysis/jobs', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  let body
  try { body = await c.req.json() } catch (_) {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const quickjs = parseQuickJSParams(body?.quickjs)
  if (quickjs.error) return c.json({ error: quickjs.error }, 400)

  const complexity = parseComplexityParams(body?.complexity, quickjs.tests)
  if (complexity.error) return c.json({ error: complexity.error }, 400)

  const runtimeJobs = []
  const runtimeErrors = []
  const multiRuntimeTests = Array.isArray(body?.multiRuntime?.tests) ? body.multiRuntime.tests : []
  for (const entry of multiRuntimeTests) {
    const params = parseRunParams(entry)
    if (params.error) {
      runtimeErrors.push(params.error)
      continue
    }
    const job = enqueueBenchmarkJob(params)
    runtimeJobs.push({
      testIndex: Number.isInteger(entry?.testIndex) ? entry.testIndex : runtimeJobs.length,
      jobId: job.jobId,
      deadlineMs: job.pollDeadlineMs,
    })
  }

  const [quickjsProfiles, complexities] = await Promise.all([
    runQuickJSAnalysis(quickjs.tests, {
      setup: quickjs.setup,
      teardown: quickjs.teardown,
      timeMs: quickjs.timeMs,
      signal: c.req.raw.signal,
    }),
    estimateComplexityBatch(complexity),
  ])

  const deadlineMs = runtimeJobs.reduce((max, job) => Math.max(max, job.deadlineMs || 0), 0)
  const multiRuntime = runtimeJobs.length > 0
    ? { jobs: runtimeJobs.map(({ testIndex, jobId }) => ({ testIndex, jobId })), deadlineMs }
    : runtimeErrors.length > 0
      ? { error: runtimeErrors[0] }
      : null

  return c.json({
    quickjsProfiles,
    complexities,
    multiRuntime,
  })
})

app.post('/api/complexity', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)

  let body
  try { body = await c.req.json() } catch (_) {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const tests = Array.isArray(body?.tests) ? body.tests : null
  if (!tests || tests.length === 0) {
    return c.json({ error: 'tests array is required and must not be empty' }, 400)
  }
  if (tests.length > 20) {
    return c.json({ error: 'Maximum 20 tests per complexity analysis' }, 400)
  }

  const setup = typeof body.setup === 'string' ? body.setup : ''
  const language = body.language === 'typescript' ? 'typescript' : 'javascript'
  const sourceMode = typeof body.sourceMode === 'string' ? body.sourceMode : 'source'
  const results = []
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]
    if (!test?.code || typeof test.code !== 'string') {
      return c.json({ error: 'Each test must have a non-empty code string' }, 400)
    }
    const complexity = estimateComplexity(test.code, { setup })
    if (language === 'typescript' && sourceMode === 'compiled-js') {
      complexity.signals = [...new Set([...(complexity.signals || []), 'compiled-source'])]
      complexity.explanation = [
        complexity.explanation,
        'TypeScript complexity was estimated from compiled JavaScript because a native TypeScript parser is not enabled on the worker.',
      ].filter(Boolean).join(' ')
    }
    results.push({
      testIndex: Number.isInteger(test.testIndex) ? test.testIndex : i,
      title: test.title || `Test ${i + 1}`,
      complexity,
    })
  }

  return c.json({ results })
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
    console.warn('[worker] cancelling job', { jobId: job.jobId })
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
  const language = body.language === 'typescript' ? 'typescript' : 'javascript'
  const languageOptions = sanitizeLanguageOptions(body.languageOptions)
  const runtimeCode = typeof body.runtimeCode === 'string' ? body.runtimeCode : code
  const runtimeSetup = typeof body.runtimeSetup === 'string' ? body.runtimeSetup : setup
  const runtimeTeardown = typeof body.runtimeTeardown === 'string' ? body.runtimeTeardown : teardown
  const timeMs = Math.min(Number(body.timeMs) || 1500, MAX_TIME_MS)
  const runtimeTargets = normalizeRuntimeTargets(body.runtimes) || DEFAULT_RUNTIME_TARGETS
  const profiles = sanitizeProfiles(body.profiles) || DEFAULT_PROFILES
  const profiling = sanitizeProfiling(body.profiling)
  const isAsync = body.isAsync === true || detectAsyncCode(code) || detectAsyncCode(runtimeCode)
  return {
    code,
    runtimeCode,
    setup,
    runtimeSetup,
    teardown,
    runtimeTeardown,
    language,
    languageOptions,
    compilerVersion: typeof body.compilerVersion === 'string' ? body.compilerVersion : null,
    sourcePrepVersion: Number.isFinite(Number(body.sourcePrepVersion)) ? Number(body.sourcePrepVersion) : null,
    timeMs,
    isAsync,
    runtimeTargets,
    profiles,
    profiling,
  }
}

function parseQuickJSParams(input) {
  const tests = sanitizeTests(input?.tests)
  if (!tests) return { error: 'quickjs.tests array is required and must not be empty' }
  return {
    tests,
    setup: typeof input?.setup === 'string' ? input.setup : '',
    teardown: typeof input?.teardown === 'string' ? input.teardown : '',
    timeMs: Math.min(Number(input?.timeMs) || 2000, MAX_TIME_MS),
  }
}

function parseComplexityParams(input, fallbackTests) {
  const tests = sanitizeTests(input?.tests) || fallbackTests
  if (!tests) return { error: 'complexity.tests array is required and must not be empty' }
  return {
    tests,
    setup: typeof input?.setup === 'string' ? input.setup : '',
    language: input?.language === 'typescript' ? 'typescript' : 'javascript',
    sourceMode: typeof input?.sourceMode === 'string' ? input.sourceMode : 'source',
  }
}

function sanitizeTests(input) {
  if (!Array.isArray(input) || input.length === 0) return null
  if (input.length > 20) return null
  const tests = []
  for (let i = 0; i < input.length; i++) {
    const test = input[i]
    if (!test?.code || typeof test.code !== 'string') return null
    tests.push({
      code: test.code,
      title: test.title || `Test ${i + 1}`,
      async: test.async === true,
      testIndex: Number.isInteger(test.testIndex) ? test.testIndex : i,
    })
  }
  return tests
}

function sanitizeProfiling(input) {
  if (!input || typeof input !== 'object') return null
  const profiling = {}
  if (input.nodeCpu === true) profiling.nodeCpu = true
  if (input.v8Jit === true) profiling.v8Jit = true
  return Object.keys(profiling).length > 0 ? profiling : null
}

async function estimateComplexityBatch({ tests, setup, language, sourceMode }) {
  const results = []
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]
    const complexity = estimateComplexity(test.code, { setup })
    if (language === 'typescript' && sourceMode === 'compiled-js') {
      complexity.signals = [...new Set([...(complexity.signals || []), 'compiled-source'])]
      complexity.explanation = [
        complexity.explanation,
        'TypeScript complexity was estimated from compiled JavaScript because a native TypeScript parser is not enabled on the worker.',
      ].filter(Boolean).join(' ')
    }
    results.push(complexity)
  }
  return results
}

function enqueueBenchmarkJob(params) {
  const jobId = randomUUID()
  const executionDeadlineMs = computeExecutionDeadlineMs(params)
  const pollDeadlineMs = computePollDeadlineMs(params, executionDeadlineMs)
  const job = {
    jobId,
    state: 'pending',
    createdAt: Date.now(),
    deadline: null,
    deadlineMs: executionDeadlineMs,
    pollDeadlineMs,
    completedAt: null,
    params: { runtimes: params.runtimeTargets, profiles: params.profiles, timeMs: params.timeMs, isAsync: params.isAsync, language: params.language },
    partial: emptyAccumulator(params.runtimeTargets),
    result: null,
    error: null,
    abortCtrl: new AbortController(),
  }
  jobs.set(jobId, job)
  console.info('[worker] enqueued job', {
    jobId,
    runtimes: runtimeIds(params.runtimeTargets),
    profiles: profileLabels(params.profiles),
    timeMs: params.timeMs,
    profiling: params.profiling || null,
    executionDeadlineMs,
    pollDeadlineMs,
  })

  // Fire-and-forget. We deliberately don't await — the response is sent
  // immediately so the caller doesn't burn its own request budget waiting
  // on Docker-backed runtimes.
  void executeJob(job, params).catch(() => { /* errors captured on job */ })
  return job
}

function emptyAccumulator(runtimeTargets) {
  const acc = {}
  for (const target of runtimeTargets) {
    acc[target.id] = {
      runtime: target.runtime,
      version: target.version,
      label: target.label,
      profiles: [],
      avgOpsPerSec: 0,
      error: null,
    }
  }
  return acc
}

async function runBenchmarkBatch(params, { signal, onProgress, accum } = {}) {
  const { code, setup, teardown, runtimeCode, runtimeSetup, runtimeTeardown, language, languageOptions, timeMs, isAsync, runtimeTargets, profiles, profiling } = params
  const accumulator = accum || emptyAccumulator(runtimeTargets)

  for (const target of runtimeTargets) {
    for (const profile of profiles) {
      if (signal?.aborted) throw new Error('aborted')

      onProgress?.({
        type: 'progress',
        runtime: target.id,
        runtimeName: target.runtime,
        version: target.version,
        profile: profile.label,
        status: 'running',
      })

      const builder = SCRIPT_BUILDERS[target.runtime]
      const nativeTypeScript = shouldUseNativeTypeScript(target, { language, languageOptions })
      const script = builder({
        code: nativeTypeScript ? code : runtimeCode,
        setup: nativeTypeScript ? setup : runtimeSetup,
        teardown: nativeTypeScript ? teardown : runtimeTeardown,
        timeMs,
        isAsync,
        language,
        nativeTypeScript,
        profiling: target.runtime === 'node' ? profiling : null,
      })

      let outcome
      try {
        outcome = await runInContainer({
          runtime: target,
          script,
          profile,
        profiling: target.runtime === 'node' || target.runtime === 'deno' ? profiling : null,
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
        ...outcome.result,
        ...(outcome.jitArtifact ? { jitArtifact: outcome.jitArtifact } : {}),
        ...(outcome.jitArtifactError ? { jitArtifactError: outcome.jitArtifactError } : {}),
        methodology: {
          ...(outcome.result.methodology || {}),
          async: Boolean(isAsync),
          repeatCount: 1,
          workerProfile: {
            cpus: profile.cpus,
            memMb: profile.memMb,
          },
        },
        stderrTail: outcome.result.state === 'errored' ? outcome.stderrTail : undefined,
      }

      if (profiling?.v8Jit === true && (target.runtime === 'node' || target.runtime === 'deno')) {
        console.info('[worker] jit capture result', {
          runtime: target.id,
          runtimeName: target.runtime,
          version: target.version,
          profile: profile.label,
          state: profileResult.state,
          exitCode: profileResult.exitCode,
          artifact: Boolean(outcome.jitArtifact),
          artifactBytes: outcome.jitArtifact?.output ? Buffer.byteLength(outcome.jitArtifact.output) : 0,
          truncated: outcome.jitArtifact?.truncated || false,
          error: outcome.jitArtifactError || null,
        })
      }

      accumulator[target.id].profiles.push(profileResult)
      if (profileResult.state === 'errored' && !accumulator[target.id].error) {
        accumulator[target.id].error = profileResult.error || 'unknown error'
      }

      onProgress?.({
        type: 'result',
        runtime: target.id,
        runtimeName: target.runtime,
        version: target.version,
        profile: profile.label,
        ...profileResult,
      })
    }
  }

  for (const target of runtimeTargets) {
    const ops = accumulator[target.id].profiles.map(p => p.opsPerSec).filter(n => n > 0)
    accumulator[target.id].avgOpsPerSec = ops.length > 0
      ? Math.round(ops.reduce((s, v) => s + v, 0) / ops.length)
      : 0
  }

  return accumulator
}

async function executeJob(job, params) {
  const prepareStart = Date.now()
  console.info('[worker] preparing job images', {
    jobId: job.jobId,
    runtimes: runtimeIds(params.runtimeTargets),
  })

  try {
    await prepareRuntimeImages(params.runtimeTargets)
    if (job.completedAt || job.abortCtrl.signal.aborted) return
    console.info('[worker] job images ready', {
      jobId: job.jobId,
      durationMs: Date.now() - prepareStart,
    })
  } catch (err) {
    if (job.state === 'errored' || job.completedAt) return
    console.error('[worker] job image preparation failed', {
      jobId: job.jobId,
      error: err.message || String(err),
    })
    finalizeJob(job, { state: 'errored', error: err.message || String(err) })
    return
  }

  job.state = 'running'
  job.deadline = Date.now() + job.deadlineMs
  scheduleDeadline(job)
  console.info('[worker] started job', {
    jobId: job.jobId,
    runtimes: runtimeIds(params.runtimeTargets),
    profiles: profileLabels(params.profiles),
    profiling: params.profiling || null,
    executionDeadlineMs: job.deadlineMs,
  })

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
    console.error('[worker] job execution failed', {
      jobId: job.jobId,
      error: err.message || String(err),
    })
    finalizeJob(job, { state: 'errored', error: err.message || String(err) })
  }
}

function finalizeJob(job, { state, result = null, error = null }) {
  if (job.completedAt) return
  job.state = state
  job.result = result
  job.error = error
  job.completedAt = Date.now()
  console.info('[worker] finalized job', {
    jobId: job.jobId,
    state,
    durationMs: job.completedAt - job.createdAt,
    error,
  })
  // Schedule TTL eviction
  setTimeout(() => jobs.delete(job.jobId), JOB_RESULT_TTL_MS).unref?.()
}

function scheduleDeadline(job) {
  setTimeout(() => {
    if (!job.completedAt) {
      console.warn('[worker] job exceeded deadline', {
        jobId: job.jobId,
        deadlineMs: job.deadlineMs,
      })
      job.abortCtrl.abort()
      finalizeJob(job, { state: 'errored', error: `job exceeded deadline of ${job.deadlineMs}ms` })
    }
  }, job.deadlineMs).unref?.()
}

function serializeJob(job) {
  return {
    jobId: job.jobId,
    state: job.state,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    deadline: job.deadline,
    deadlineMs: job.deadlineMs,
    pollDeadlineMs: job.pollDeadlineMs,
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

function runtimeIds(runtimeTargets) {
  return (runtimeTargets || []).map(target => target.id)
}

function profileLabels(profiles) {
  return (profiles || []).map(profile => `${profile.label}:${profile.cpus}cpu/${profile.memMb}mb`)
}

function detectAsyncCode(code) {
  return typeof code === 'string' && (
    code.includes('deferred.resolve') ||
    code.includes('await ') ||
    code.includes('return new Promise')
  )
}

function shouldUseNativeTypeScript(target, { language, languageOptions }) {
  if (language !== 'typescript') return false
  if (languageOptions?.runtimeMode === 'compiled-everywhere') return false
  return target?.runtime === 'deno' || target?.runtime === 'bun'
}

function sanitizeLanguageOptions(input) {
  if (!input || typeof input !== 'object') return null
  return {
    runtimeMode: input.runtimeMode === 'compiled-everywhere'
      ? 'compiled-everywhere'
      : 'native-where-available',
    target: typeof input.target === 'string' ? input.target : 'es2020',
    jsx: input.jsx === true,
    typeCheck: false,
    imports: false,
  }
}

function computeExecutionDeadlineMs({ runtimeTargets, profiles, timeMs }) {
  if (FIXED_JOB_DEADLINE_MS) return FIXED_JOB_DEADLINE_MS

  const runCount = Math.max(1, (runtimeTargets || []).length * (profiles || []).length)
  const runBudgetMs = runCount * (Math.min(Number(timeMs) || 1500, MAX_TIME_MS) + 8_000)
  const computed = MIN_JOB_DEADLINE_MS + runBudgetMs

  return Math.min(MAX_JOB_DEADLINE_MS, Math.max(MIN_JOB_DEADLINE_MS, computed))
}

function computePollDeadlineMs({ runtimeTargets }, executionDeadlineMs) {
  const versionedImages = new Set(
    (runtimeTargets || [])
      .filter(target => target.pull)
      .map(target => target.image),
  )
  return executionDeadlineMs + (versionedImages.size * VERSIONED_IMAGE_PULL_GRACE_MS)
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
