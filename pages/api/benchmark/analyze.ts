// @ts-nocheck
import { analysesCollection } from '../../../lib/mongodb'
import { redis } from '../../../lib/redis'
import { runAnalysis } from '../../../lib/engines/runner'
import { estimateComplexitiesOnWorker } from '../../../lib/engines/complexity'
import { enqueueMultiRuntimeJob } from '../../../lib/engines/multiruntime'
import { loadStoredMultiRuntimeResults } from '../../../lib/multiRuntimeResults'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../../lib/rateLimit'
import { findBrowserApiUsage, isAsyncTest } from '../../../lib/benchmark/detection'
import { buildBenchmarkDoctor } from '../../../lib/benchmark/doctor'
import {
  inferBenchmarkLanguage,
  prepareBenchmarkSources,
  normalizeLanguageOptions,
  SourcePreparationError,
} from '../../../lib/benchmark/source'
import crypto from 'crypto'

// Deep analysis boots V8/QuickJS sandboxes (~25-30s of CPU per call), so a
// per-minute window let a free IP sustain ~60 runs/hour. A 5-minute window
// caps free users at 24/hour while still allowing a quick iteration burst,
// and donors get 10 per 5 minutes for comfortable back-to-back tweaking.
const RATE_LIMIT = { free: 2, donor: 10, window: '5 m' }
const DEEP_ANALYSIS_LIMIT_MS = 60_000
// Keep a small response window before Vercel's 60s function ceiling so the
// client receives a friendly NDJSON error instead of a platform timeout.
const DEEP_ANALYSIS_ABORT_MS = 58_000

// Next.js requires segment config to be statically analyzable, so this
// has to be a literal — no env-conditional expression. 60s is the non-donor
// deep-analysis limit and the Hobby plan ceiling. Multi-runtime work is
// enqueued asynchronously and the base QuickJS/V8/complexity phases run in
// parallel under the same deadline.
//
// Synchronous budget:
//   - QuickJS:    4 memory profiles × ~1.5s, sequential inside its phase
//   - V8 sandbox: 1 canonical single-vCPU run per test, sequential inside phase
//   - Worker:     multi-runtime enqueue + complexity request
//   - Prediction: built after the parallel phases resolve
export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  let rateLimitTier = 'free'

  try {
    const rl = await applyTieredRateLimit(req, 'analyze', RATE_LIMIT)
    rateLimitTier = rl.tier || 'free'
    setRateLimitHeaders(res, rl)
    if (!rl.success) {
      const cap = rl.tier === 'donor' ? RATE_LIMIT.donor : RATE_LIMIT.free
      return res.status(429).json({
        error: `Too many requests. Deep analysis is limited to ${cap} every 5 minutes${rl.tier === 'donor' ? ' for donors' : ''}.`,
        tier: rl.tier,
      })
    }

    const { tests, setup, teardown, slug, revision, force } = req.body
    const language = inferBenchmarkLanguage({
      language: req.body?.language,
      tests,
      setup,
      teardown,
    })
    const languageOptions = normalizeLanguageOptions(language, req.body?.languageOptions)
    const multiRuntimeOptions = parseMultiRuntimeOptions(req.body)

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

    let prepared
    try {
      prepared = prepareBenchmarkSources({ tests, setup, teardown, language, languageOptions })
    } catch (err) {
      if (err instanceof SourcePreparationError) {
        return res.status(400).json({
          error: err.message,
          details: err.details || null,
        })
      }
      throw err
    }

    // Cache by content hash for the base QuickJS + V8 analysis only.
    // Multi-runtime results use their own key and are stored durably in MongoDB
    // because selected Node/Deno/Bun versions affect the result independently.
    const codeHash = computeCodeHash(prepared)
    const multiRuntimeCacheKey = computeMultiRuntimeCacheKey(prepared, multiRuntimeOptions)
    const cacheKey = `analysis_v8:${codeHash}`

    // `force: true` from the "Re-analyze" button busts the Redis cache
    // so the user always gets a fresh QuickJS+V8 run. The MongoDB
    // snapshot is still appended below — the latest doc wins for future
    // page loads.
    if (force === true) {
      try { await redis.del(cacheKey) } catch (_) { /* non-fatal */ }
    }

    const cached = !force ? await redis.get(cacheKey) : null
    if (cached) {
      const cachedData = typeof cached === 'string' ? JSON.parse(cached) : cached
      const cachedWithDoctor = attachBenchmarkDoctor(cachedData, prepared)
      // On cache HIT we still attach durable MR results when available, or
      // give the client fresh MR jobIds so it can poll for missing data.
      const mrInfo = await maybeEnqueueMultiRuntime(
        prepared,
        multiRuntimeCacheKey,
        multiRuntimeOptions,
        { signal: AbortSignal.timeout(DEEP_ANALYSIS_ABORT_MS) },
      )
      const merged = { ...mergeMultiRuntimeMeta(cachedWithDoctor, mrInfo), codeHash, multiRuntimeCacheKey }
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
    if (process.env.BENCHMARK_WORKER_URL) {
      enabledEngines.push('multi-runtime')
      enabledEngines.push('complexity')
    }
    enabledEngines.push('prediction')
    sendLine({ type: 'pipeline', engines: enabledEngines })

    const analysisSignal = AbortSignal.timeout(DEEP_ANALYSIS_ABORT_MS)

    // Kick off MR jobs FIRST so they run on the worker concurrently with
    // QuickJS+V8+complexity here. By the time we finish those phases the
    // worker is typically already done, so the client's first poll gets results.
    const mrInfo = await maybeEnqueueMultiRuntime(
      prepared,
      multiRuntimeCacheKey,
      multiRuntimeOptions,
      { signal: analysisSignal },
    )
    if (mrInfo?.stored) {
      sendLine({
        type: 'multi-runtime-stored',
        results: mrInfo.results,
      })
    } else if (mrInfo?.jobs) {
      sendLine({
        type: 'multi-runtime-enqueued',
        jobs: mrInfo.jobs,
        codeHash: multiRuntimeCacheKey,
        deadlineMs: mrInfo.deadlineMs,
        deadlineAt: mrInfo.deadlineAt,
      })
    } else if (mrInfo?.error) {
      sendLine({ type: 'multi-runtime-unavailable', error: mrInfo.error })
    }

    const analysis = await runAnalysis(prepared.runtime.tests, {
      setup: prepared.runtime.setup || undefined,
      teardown: prepared.runtime.teardown || undefined,
      timeMs: 2000,
      signal: analysisSignal,
      onProgress: (step) => sendLine({ type: 'progress', ...step }),
      estimateComplexities: process.env.BENCHMARK_WORKER_URL
        ? (runtimeTests, opts) => estimateComplexitiesOnWorker(runtimeTests, {
            ...opts,
            language: prepared.language,
            languageOptions: prepared.languageOptions,
            sourceMode: prepared.language === 'typescript' ? 'compiled-js' : 'source',
          })
        : undefined,
    })
    const analysisWithMeta = attachBenchmarkDoctor({
      ...analysis,
      meta: {
        ...(analysis.meta || {}),
        sourcePrepMs: prepared.conversionMs,
        compiler: prepared.compilerVersion
          ? { name: 'typescript', version: prepared.compilerVersion }
          : null,
        language: prepared.language,
        languageOptions: prepared.languageOptions,
        sourcePrepVersion: prepared.sourcePrepVersion,
      },
    }, prepared)

    const analyses = await analysesCollection()
    const doc = {
      codeHash,
      multiRuntimeCacheKey,
      slug: slug ? String(slug) : null,
      revision: revision ? parseInt(revision, 10) : null,
      results: analysisWithMeta.results,
      comparison: analysisWithMeta.comparison,
      hasErrors: analysisWithMeta.hasErrors || false,
      meta: analysisWithMeta.meta,
      doctor: analysisWithMeta.doctor,
      createdAt: new Date(),
    }
    await analyses.insertOne(doc)

    if (!analysisWithMeta.hasErrors) {
      await redis.setex(cacheKey, 3600, JSON.stringify(analysisWithMeta))
    }

    const final = { ...mergeMultiRuntimeMeta(analysisWithMeta, mrInfo), codeHash, multiRuntimeCacheKey }
    sendLine({ type: 'result', data: final })
    return res.end()
  } catch (error) {
    console.error('Analysis error:', error)

    if (res.headersSent) {
      const errMsg = isAbortError(error)
        ? formatAnalysisTimeoutMessage(rateLimitTier)
        : 'Internal Server Error'
      res.write(JSON.stringify({ type: 'error', error: errMsg }) + '\n')
      return res.end()
    }

    if (isAbortError(error)) {
      return res.status(504).json({ error: formatAnalysisTimeoutMessage(rateLimitTier) })
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
async function maybeEnqueueMultiRuntime(prepared, cacheKey, options = {}, { signal } = {}) {
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

function mergeMultiRuntimeMeta(analysis, mrInfo) {
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

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

function formatAnalysisTimeoutMessage(tier) {
  const seconds = Math.round(DEEP_ANALYSIS_LIMIT_MS / 1000)
  return tier === 'donor'
    ? `Deep analysis exceeded the ${seconds} second execution limit. Please try fewer tests or simplify the benchmark.`
    : `Deep analysis is limited to ${seconds} seconds for non-donors. Please try fewer tests or simplify the benchmark.`
}

function parseMultiRuntimeOptions(body) {
  const runtimes = normalizeRuntimeRequest(body?.runtimes)
  return runtimes ? { runtimes } : {}
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
