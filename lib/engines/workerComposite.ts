/**
 * Composite worker client for donor Deep Analysis.
 *
 * This keeps Vercel-specific orchestration in the app while moving the
 * worker-safe phases (QuickJS, complexity, and runtime job enqueue) behind
 * one authenticated worker request.
 */
import { findBrowserApiUsage, isAsyncTest } from '../benchmark/detection'
import { loadStoredMultiRuntimeResults } from '../multiRuntimeResults'

type WorkerCompositeOptions = { signal?: AbortSignal }

export async function runWorkerCompositeAnalysis(session: any, { signal }: WorkerCompositeOptions = {}) {
  const workerUrl = process.env.BENCHMARK_WORKER_URL
  if (!workerUrl) {
    return { unavailable: true, error: 'Worker-side analysis is not configured' }
  }

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

  const stored = await loadStoredMultiRuntimeResults(
    cacheKey,
    runnableTests.map(({ index }) => ({ testIndex: index })),
    { requireAll: true },
  )

  const multiRuntimeFallback = buildMultiRuntimeFallback({
    prepared,
    cacheKey,
    runnableTests,
    stored,
    setup,
    teardown,
  })

  let response
  try {
    response = await fetch(`${workerUrl.replace(/\/+$/, '')}/api/analysis/jobs`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        quickjs: {
          tests: prepared.runtime.tests,
          setup: prepared.runtime.setup || undefined,
          teardown: prepared.runtime.teardown || undefined,
          timeMs: 2000,
        },
        complexity: {
          tests: prepared.runtime.tests,
          setup: prepared.runtime.setup || undefined,
          language: prepared.language,
          languageOptions: prepared.languageOptions,
          sourceMode: prepared.language === 'typescript' ? 'compiled-js' : 'source',
        },
        multiRuntime: {
          tests: stored ? [] : runnableTests.map(({ originalTest, runtimeTest, index }) => ({
            testIndex: index,
            code: originalTest.code,
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
            ...options,
          })),
        },
      }),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    return { unavailable: true, error: `Worker unreachable: ${(err as Error).message || String(err)}` }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { unavailable: true, error: `Worker error ${response.status}: ${text.slice(0, 200)}` }
  }

  const body = await response.json().catch(() => null)
  const quickjsProfiles = normalizeQuickJSProfiles(body?.quickjsProfiles, prepared.runtime.tests.length)
  if (!quickjsProfiles) {
    return { unavailable: true, error: 'Worker response missing QuickJS profiles' }
  }

  return {
    quickjsProfiles,
    complexities: Array.isArray(body?.complexities)
      ? body.complexities
      : Array(prepared.runtime.tests.length).fill(null),
    multiRuntime: multiRuntimeFallback || normalizeMultiRuntime(body?.multiRuntime, cacheKey, options),
  }
}

function buildMultiRuntimeFallback({ prepared, runnableTests, stored, setup, teardown }: any) {
  if (stored) return { stored: true, ...stored }

  if (runnableTests.length > 0) return null

  if (!process.env.BENCHMARK_WORKER_URL) return null
  return { error: formatBrowserApiSkip(prepared.original.tests, setup, teardown) }
}

function normalizeQuickJSProfiles(value: unknown, testCount: number) {
  if (!Array.isArray(value) || value.length !== testCount) return null
  return value.every(profiles => Array.isArray(profiles)) ? value : null
}

function normalizeMultiRuntime(value: any, cacheKey: string, options: any = {}) {
  if (!value) return null
  if (Array.isArray(value.jobs) && value.jobs.length > 0) {
    const deadlineMs = Number(value.deadlineMs) || 30_000
    return {
      jobs: value.jobs,
      deadlineMs,
      deadlineAt: Date.now() + deadlineMs,
      cacheKey,
      profiling: options.profiling || null,
    }
  }
  if (value.error || value.unavailable) {
    return { unavailable: Boolean(value.unavailable), error: value.error || 'Worker runtime jobs unavailable' }
  }
  return null
}

function workerHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.BENCHMARK_WORKER_SECRET) {
    headers.Authorization = `Bearer ${process.env.BENCHMARK_WORKER_SECRET}`
  }
  return headers
}

function isPreparedAsync(originalTest: any, runtimeTest: any) {
  return isAsyncTest(originalTest) || isAsyncTest(runtimeTest)
}

function formatBrowserApiSkip(tests: any[], setup: string, teardown: string) {
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
