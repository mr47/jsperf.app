// @ts-nocheck
/**
 * Multi-runtime benchmark engine — async job pattern.
 *
 * The remote worker exposes a job-based API:
 *   POST /api/jobs       enqueue, returns { jobId } in 202 immediately
 *   GET  /api/jobs/:id   poll for { state, result, error, partial }
 *
 * jsperf.net's /api/benchmark/analyze enqueues jobs concurrently with the
 * synchronous QuickJS + V8 phases so that:
 *   1. The Vercel serverless function returns inside its 60s ceiling
 *      regardless of how long the worker takes.
 *   2. The browser polls the worker (via our /api/benchmark/multi-runtime
 *      proxy) on its own clock.
 *
 * The engine is purely additive: if BENCHMARK_WORKER_URL is unset we return
 * null and the analysis pipeline carries on with QuickJS + V8 only.
 */

import { findBrowserApiGlobals } from '../benchmark/detection'

const DEFAULT_RUNTIMES = ['node', 'deno', 'bun']

// Single profile by default — see runner.js for the rationale (we get
// cross-runtime comparison from one profile and can keep wall-clock low).
const DEFAULT_PROFILES = [
  { label: '1x', resourceLevel: 1, cpus: 1.0, memMb: 512 },
]

/**
 * Enqueue a multi-runtime benchmark job on the remote worker.
 *
 * @param {string} code
 * @param {object} opts
 * @param {string} [opts.setup]
 * @param {string} [opts.teardown]
 * @param {number} [opts.timeMs=1500]
 * @param {boolean} [opts.isAsync=false]
 * @param {Array<string|{runtime: string, version?: string}>} [opts.runtimes]
 *   Examples: ['node', 'deno', 'bun'], ['node@22', 'node@24'],
 *   or [{ runtime: 'bun', version: '1.3.0' }].
 * @param {Array} [opts.profiles]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ jobId: string, deadlineMs: number } | null>}
 *   - { jobId } on success
 *   - { unavailable: true, error } if worker is configured but unreachable
 *   - null if worker is not configured (BENCHMARK_WORKER_URL unset)
 */
export async function enqueueMultiRuntimeJob(code, {
  runtimeCode,
  setup,
  runtimeSetup,
  teardown,
  runtimeTeardown,
  language = 'javascript',
  languageOptions = null,
  compilerVersion = null,
  sourcePrepVersion = null,
  timeMs = 1500,
  isAsync = false,
  runtimes = DEFAULT_RUNTIMES,
  profiles = DEFAULT_PROFILES,
  profiling = null,
  signal,
} = {}) {
  const workerUrl = process.env.BENCHMARK_WORKER_URL
  if (!workerUrl) return null

  const browserApis = findBrowserApiGlobals([
    typeof setup === 'string' ? setup : '',
    typeof code === 'string' ? code : '',
    typeof teardown === 'string' ? teardown : '',
  ].join('\n'))
  if (browserApis.length > 0) {
    return {
      unavailable: true,
      error: `Skipped Node / Deno / Bun comparison because browser APIs were detected (${browserApis.slice(0, 5).join(', ')}).`,
    }
  }

  console.info('[analysis] enqueue multi-runtime worker job', {
    workerUrl: redactWorkerUrl(workerUrl),
    runtimes,
    profiles: profiles.map(profile => profile.label),
    timeMs,
    isAsync,
    profiling,
  })

  let response
  try {
    response = await fetch(`${workerUrl.replace(/\/+$/, '')}/api/jobs`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        code,
        runtimeCode,
        setup,
        runtimeSetup,
        teardown,
        runtimeTeardown,
        language,
        languageOptions,
        compilerVersion,
        sourcePrepVersion,
        timeMs,
        isAsync,
        runtimes,
        profiles,
        profiling,
      }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    console.warn('[analysis] multi-runtime worker unreachable', {
      workerUrl: redactWorkerUrl(workerUrl),
      error: err.message || String(err),
    })
    return { unavailable: true, error: `Worker unreachable: ${err.message || String(err)}` }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn('[analysis] multi-runtime worker enqueue failed', {
      workerUrl: redactWorkerUrl(workerUrl),
      status: response.status,
      body: text.slice(0, 200),
    })
    return { unavailable: true, error: `Worker error ${response.status}: ${text.slice(0, 200)}` }
  }

  const body = await response.json().catch(() => ({}))
  console.info('[analysis] multi-runtime worker enqueue response', {
    workerUrl: redactWorkerUrl(workerUrl),
    jobId: body.jobId || null,
    deadlineMs: body.deadlineMs || null,
    state: body.state || null,
  })
  if (!body.jobId) {
    return { unavailable: true, error: 'Worker response missing jobId' }
  }

  return { jobId: body.jobId, deadlineMs: body.deadlineMs || 30_000 }
}

/**
 * Fetch the current status / result of a multi-runtime job.
 *
 * Server-side use only — exposes BENCHMARK_WORKER_SECRET via the request
 * header. The browser hits this through pages/api/benchmark/multi-runtime/
 * [jobId].js which never returns the secret.
 *
 * @param {string} jobId
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object|null>} job status, or null if jobId unknown / 404
 */
export async function getMultiRuntimeJob(jobId, { signal } = {}) {
  const workerUrl = process.env.BENCHMARK_WORKER_URL
  if (!workerUrl) return null
  if (!jobId) return null

  let response
  try {
    response = await fetch(
      `${workerUrl.replace(/\/+$/, '')}/api/jobs/${encodeURIComponent(jobId)}`,
      { headers: workerHeaders(), signal },
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    return { unavailable: true, error: `Worker unreachable: ${err.message || String(err)}` }
  }

  if (response.status === 404) return null
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { unavailable: true, error: `Worker error ${response.status}: ${text.slice(0, 200)}` }
  }

  return response.json().catch(() => null)
}

function workerHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.BENCHMARK_WORKER_SECRET) {
    headers.Authorization = `Bearer ${process.env.BENCHMARK_WORKER_SECRET}`
  }
  return headers
}

function redactWorkerUrl(workerUrl) {
  try {
    const url = new URL(workerUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return workerUrl ? '[configured]' : '[missing]'
  }
}
