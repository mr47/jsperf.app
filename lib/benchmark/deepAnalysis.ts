import crypto from 'crypto'
import { redis } from '../redis'
import { analysesCollection } from '../mongodb'
import { enqueueMultiRuntimeJob } from '../engines/multiruntime'
import { estimateComplexitiesOnWorker } from '../engines/complexity'
import { loadStoredMultiRuntimeResults } from '../multiRuntimeResults'
import { findBrowserApiUsage, isAsyncTest } from './detection'
import { buildBenchmarkDoctor } from './doctor'
import {
  inferBenchmarkLanguage,
  prepareBenchmarkSources,
  normalizeLanguageOptions,
  SourcePreparationError,
} from './source'

type AnalysisRequestBody = Record<string, any>
type AnalysisSession = Record<string, any>
type AbortOptions = { signal?: AbortSignal }
type StatusError = Error & { status?: number }

export const RATE_LIMIT = { free: 2, donor: 10, window: '5 m' }
export const DEEP_ANALYSIS_LIMIT_MS = 60_000
export const DONOR_DEEP_ANALYSIS_LIMIT_MS = 10 * 60_000
export const DEEP_ANALYSIS_ABORT_MS = 58_000
export const ANALYSIS_SESSION_TTL_SECONDS = 15 * 60
export const WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE = 'quickjs-composite'

export function prepareDeepAnalysisRequest(body: AnalysisRequestBody = {}) {
  const { tests, setup, teardown, slug, revision, force } = body
  const language = inferBenchmarkLanguage({
    language: body?.language,
    tests,
    setup,
    teardown,
  })
  const languageOptions = normalizeLanguageOptions(language, body?.languageOptions)
  const multiRuntimeOptions = parseMultiRuntimeOptions(body)
  const workerExecutionMode = normalizeWorkerExecutionMode(body?.workerExecutionMode)

  if (!tests || !Array.isArray(tests) || tests.length === 0) {
    return { error: { status: 400, body: { error: 'tests array is required and must not be empty' } } }
  }

  if (tests.length > 20) {
    return { error: { status: 400, body: { error: 'Maximum 20 tests per analysis' } } }
  }

  for (const test of tests) {
    if (!test.code || typeof test.code !== 'string') {
      return { error: { status: 400, body: { error: 'Each test must have a non-empty code string' } } }
    }
  }

  let prepared
  try {
    prepared = prepareBenchmarkSources({ tests, setup, teardown, language, languageOptions })
  } catch (err) {
    if (err instanceof SourcePreparationError) {
      return {
        error: {
          status: 400,
          body: { error: err.message, details: err.details || null },
        },
      }
    }
    throw err
  }

  const codeHash = computeCodeHash(prepared)
  const multiRuntimeCacheKey = computeMultiRuntimeCacheKey(prepared, multiRuntimeOptions)
  const cacheKey = `analysis_v8:${codeHash}`

  return {
    prepared,
    multiRuntimeOptions,
    workerExecutionMode,
    codeHash,
    multiRuntimeCacheKey,
    cacheKey,
    slug,
    revision,
    force,
  }
}

export function createAnalysisSession(payload) {
  const deadlineMs = payload?.tier === 'donor'
    ? DONOR_DEEP_ANALYSIS_LIMIT_MS
    : DEEP_ANALYSIS_LIMIT_MS

  return {
    id: crypto.randomUUID(),
    deadlineAt: Date.now() + deadlineMs,
    ...payload,
  }
}

export async function saveAnalysisSession(session) {
  await redis.setex(analysisSessionKey(session.id), ANALYSIS_SESSION_TTL_SECONDS, JSON.stringify(session))
}

export async function loadAnalysisSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null
  const raw = await redis.get(analysisSessionKey(sessionId))
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

export function sessionAbortSignal(session) {
  const remainingMs = Math.max(1, Math.min(DEEP_ANALYSIS_ABORT_MS, (session?.deadlineAt || 0) - Date.now() - 1_000))
  return AbortSignal.timeout(remainingMs)
}

export function assertSessionActive(session) {
  if (!session) {
    const err = new Error('Analysis session expired') as StatusError
    err.status = 404
    throw err
  }
  if (Date.now() >= session.deadlineAt) {
    const err = new Error('Analysis timed out')
    err.name = 'TimeoutError'
    throw err
  }
}

export function buildPipeline({ workerExecutionMode }: { workerExecutionMode?: string | null } = {}) {
  if (workerExecutionMode === WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE && process.env.BENCHMARK_WORKER_URL) {
    return ['quickjs-worker', 'v8', 'prediction']
  }

  const engines = ['quickjs', 'v8']
  if (process.env.BENCHMARK_WORKER_URL) {
    engines.push('multi-runtime')
    engines.push('complexity')
  }
  engines.push('prediction')
  return engines
}

export async function readCachedAnalysis(session) {
  if (session.force === true) {
    try { await redis.del(session.cacheKey) } catch (_) { /* non-fatal */ }
    return null
  }

  const cached = await redis.get(session.cacheKey)
  if (!cached) return null
  const cachedData = typeof cached === 'string' ? JSON.parse(cached) : cached
  return attachBenchmarkDoctor(cachedData, session.prepared)
}

export async function estimateComplexitiesForSession(session: AnalysisSession, signal?: AbortSignal) {
  if (!process.env.BENCHMARK_WORKER_URL) return Array(session.prepared.runtime.tests.length).fill(null)
  const results = await estimateComplexitiesOnWorker(session.prepared.runtime.tests, {
    setup: session.prepared.runtime.setup || undefined,
    signal,
    language: session.prepared.language,
    languageOptions: session.prepared.languageOptions,
    sourceMode: session.prepared.language === 'typescript' ? 'compiled-js' : 'source',
  })
  return Array.isArray(results) ? results : Array(session.prepared.runtime.tests.length).fill(null)
}

export async function maybeEnqueueMultiRuntime(session: AnalysisSession, { signal }: AbortOptions = {}) {
  const { prepared, multiRuntimeCacheKey: cacheKey, multiRuntimeOptions: options = {} } = session
  const setup = prepared.original.setup
  const teardown = prepared.original.teardown
  const runnableTests = prepared.original.tests
    .map((test, index) => ({
      originalTest: test,
      runtimeTest: prepared.runtime.tests[index],
      index,
      browserApis: findBrowserApiUsage(test, { setup, teardown }),
    }))
    .filter(entry => entry.browserApis.length === 0)

  if (runnableTests.length === 0) {
    if (!process.env.BENCHMARK_WORKER_URL) return null
    return { error: formatBrowserApiSkip(prepared.original.tests, setup, teardown) }
  }

  const stored = await loadStoredMultiRuntimeResults(
    cacheKey,
    runnableTests.map(({ index }) => ({ testIndex: index })),
    { requireAll: true }
  )
  if (stored) return { stored: true, ...stored }

  if (!process.env.BENCHMARK_WORKER_URL) return null

  const enqueues = await Promise.all(runnableTests.map(({ originalTest, runtimeTest, index: i }) =>
    enqueueMultiRuntimeJob(originalTest.code, {
      runtimeCode: runtimeTest.code,
      setup: prepared.original.setup,
      runtimeSetup: prepared.runtime.setup,
      teardown: prepared.original.teardown,
      runtimeTeardown: prepared.runtime.teardown,
      language: prepared.language,
      languageOptions: prepared.languageOptions,
      compilerVersion: prepared.compilerVersion,
      sourcePrepVersion: prepared.sourcePrepVersion,
      timeMs: 1500,
      isAsync: isPreparedAsync(originalTest, runtimeTest),
      signal,
      ...options,
    })
      .then(res => ({ testIndex: i, res }))
      .catch(err => {
        if (isAbortError(err)) throw err
        return { testIndex: i, res: { unavailable: true, error: err.message || String(err) } }
      })
  ))

  const successes = enqueues.filter(e => e.res?.jobId)
  if (successes.length === 0) {
    const firstError = enqueues.find(e => e.res?.unavailable)?.res?.error
    return { error: firstError || 'Failed to enqueue multi-runtime jobs' }
  }

  const deadlineMs = successes[0].res.deadlineMs || DEEP_ANALYSIS_LIMIT_MS
  return {
    jobs: successes.map(s => ({ testIndex: s.testIndex, jobId: s.res.jobId })),
    deadlineMs,
    deadlineAt: Date.now() + deadlineMs,
    cacheKey,
  }
}

export function attachAnalysisMeta(analysis, session) {
  return attachBenchmarkDoctor({
    ...analysis,
    meta: {
      ...(analysis.meta || {}),
      sourcePrepMs: session.prepared.conversionMs,
      compiler: session.prepared.compilerVersion
        ? { name: 'typescript', version: session.prepared.compilerVersion }
        : null,
      language: session.prepared.language,
      languageOptions: session.prepared.languageOptions,
      sourcePrepVersion: session.prepared.sourcePrepVersion,
    },
  }, session.prepared)
}

export async function persistAnalysis(session, analysisWithMeta) {
  const analyses = await analysesCollection()
  await analyses.insertOne({
    codeHash: session.codeHash,
    multiRuntimeCacheKey: session.multiRuntimeCacheKey,
    slug: session.slug ? String(session.slug) : null,
    revision: session.revision ? parseInt(session.revision, 10) : null,
    results: analysisWithMeta.results,
    comparison: analysisWithMeta.comparison,
    hasErrors: analysisWithMeta.hasErrors || false,
    meta: analysisWithMeta.meta,
    doctor: analysisWithMeta.doctor,
    createdAt: new Date(),
  })

  if (!analysisWithMeta.hasErrors) {
    await redis.setex(session.cacheKey, 3600, JSON.stringify(analysisWithMeta))
  }
}

export function mergeMultiRuntimeMeta(analysis, mrInfo) {
  if (!mrInfo) return analysis
  let multiRuntime
  if (mrInfo.jobs) {
    multiRuntime = { jobs: mrInfo.jobs, deadlineMs: mrInfo.deadlineMs, deadlineAt: mrInfo.deadlineAt, cacheKey: mrInfo.cacheKey }
  } else if (mrInfo.stored) {
    multiRuntime = { results: mrInfo.results, fromStore: true, cacheKey: mrInfo.cacheKey }
  } else {
    multiRuntime = { unavailable: true, error: mrInfo.error }
  }
  return {
    ...analysis,
    multiRuntime,
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

export function formatAnalysisTimeoutMessage(tier) {
  const seconds = Math.round(DEEP_ANALYSIS_LIMIT_MS / 1000)
  return tier === 'donor'
    ? `Deep analysis exceeded the ${seconds} second execution limit. Please try fewer tests or simplify the benchmark.`
    : `Deep analysis is limited to ${seconds} seconds for non-donors. Please try fewer tests or simplify the benchmark.`
}

export function handleApiError(error, res, tier = 'free') {
  if (error?.status && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message || 'Analysis request failed' })
  }
  if (isAbortError(error)) {
    return res.status(504).json({ error: formatAnalysisTimeoutMessage(tier) })
  }
  console.error('Analysis error:', error)
  return res.status(500).json({ error: 'Internal Server Error' })
}

function attachBenchmarkDoctor(analysis, prepared) {
  if (!analysis) return analysis
  return {
    ...analysis,
    doctor: buildBenchmarkDoctor({
      tests: prepared.original.tests,
      setup: prepared.original.setup,
      teardown: prepared.original.teardown,
      results: analysis.results || [],
    }),
  }
}

function computeCodeHash(prepared) {
  const content = JSON.stringify({
    language: prepared.language,
    languageOptions: prepared.languageOptions,
    compilerVersion: prepared.compilerVersion,
    sourcePrepVersion: prepared.sourcePrepVersion,
    tests: prepared.original.tests.map((t, i) => ({
      code: t.code.trim(),
      runtimeCode: prepared.runtime.tests[i]?.code?.trim() || '',
      async: isPreparedAsync(t, prepared.runtime.tests[i]),
    })),
    setup: prepared.original.setup.trim(),
    runtimeSetup: prepared.runtime.setup.trim(),
    teardown: prepared.original.teardown.trim(),
    runtimeTeardown: prepared.runtime.teardown.trim(),
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function computeMultiRuntimeCacheKey(prepared, options) {
  const content = JSON.stringify({
    language: prepared.language,
    languageOptions: prepared.languageOptions,
    compilerVersion: prepared.compilerVersion,
    sourcePrepVersion: prepared.sourcePrepVersion,
    tests: prepared.original.tests.map((t, i) => ({
      code: t.code.trim(),
      runtimeCode: prepared.runtime.tests[i]?.code?.trim() || '',
      async: isPreparedAsync(t, prepared.runtime.tests[i]),
    })),
    setup: prepared.original.setup.trim(),
    runtimeSetup: prepared.runtime.setup.trim(),
    teardown: prepared.original.teardown.trim(),
    runtimeTeardown: prepared.runtime.teardown.trim(),
    runtimes: options.runtimes || null,
    profiling: options.profiling || null,
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function isPreparedAsync(originalTest, runtimeTest) {
  return isAsyncTest(originalTest) || isAsyncTest(runtimeTest)
}

function formatBrowserApiSkip(tests, setup, teardown) {
  const apiNames = new Set()
  for (const test of tests) {
    for (const apiName of findBrowserApiUsage(test, { setup, teardown })) {
      apiNames.add(apiName)
    }
  }

  const names = [...apiNames].slice(0, 5).join(', ')
  return names
    ? `Skipped Node / Deno / Bun comparison because browser APIs were detected (${names}).`
    : 'Skipped Node / Deno / Bun comparison because browser APIs were detected.'
}

function parseMultiRuntimeOptions(body) {
  const runtimes = normalizeRuntimeRequest(body?.runtimes)
  const profiling = normalizeProfilingRequest(body?.profiling)
  return {
    ...(runtimes ? { runtimes } : {}),
    ...(profiling ? { profiling } : {}),
  }
}

function normalizeProfilingRequest(input) {
  if (!input || typeof input !== 'object') return null
  return input.nodeCpu === true ? { nodeCpu: true } : null
}

function normalizeWorkerExecutionMode(input) {
  return input === WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE
    ? WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE
    : null
}

function normalizeRuntimeRequest(input) {
  if (!Array.isArray(input)) return null

  const cleaned = input
    .slice(0, 12)
    .map((item) => {
      if (typeof item === 'string') {
        const value = item.trim()
        return value.length > 0 && value.length <= 100 ? value : null
      }
      if (!item || typeof item !== 'object') return null
      const runtime = typeof item.runtime === 'string' ? item.runtime.trim() : ''
      const version = item.version == null ? null : String(item.version).trim()
      if (!runtime || runtime.length > 20) return null
      if (version != null && (!version || version.length > 100)) return null
      return version == null ? { runtime } : { runtime, version }
    })
    .filter(Boolean)

  return cleaned.length > 0 ? cleaned : null
}

function analysisSessionKey(sessionId) {
  return `analysis_session:${sessionId}`
}
