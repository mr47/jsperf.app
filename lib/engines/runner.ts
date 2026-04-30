// @ts-nocheck
/**
 * Multi-engine benchmark orchestrator.
 *
 * Runs benchmark code through QuickJS-WASM (deterministic) and V8 Sandbox
 * (realistic JIT) engines, then builds a prediction model from the
 * combined results.
 *
 * Multi-runtime (Node/Deno/Bun) analysis used to live here as a third
 * phase but it has been moved out to the /api/benchmark/analyze handler
 * which enqueues an async job on the remote worker concurrently with the
 * QuickJS, V8, and complexity phases. That keeps the Vercel function inside
 * its 60s ceiling regardless of how long the worker takes — see
 * lib/engines/multiruntime.js.
 */

import { runInQuickJS } from './quickjs'
import { runInV8Sandbox } from './v8sandbox'
import { buildPrediction, compareTests } from '../prediction/model'
import { isAsyncTest } from '../benchmark/detection'

const QUICKJS_MEMORY_PROFILES = [
  { label: '0.5x', resourceLevel: 0.5, memoryLimit: 8 * 1024 * 1024 },
  { label: '1x', resourceLevel: 1, memoryLimit: 16 * 1024 * 1024 },
  { label: '2x', resourceLevel: 2, memoryLimit: 32 * 1024 * 1024 },
  { label: '4x', resourceLevel: 4, memoryLimit: 64 * 1024 * 1024 },
]

// JavaScript snippets are single-threaded unless they explicitly spin up
// workers. The canonical V8 run therefore stays on one vCPU instead of
// pretending that extra cores are a scaling axis.
const V8_CANONICAL_PROFILE = { label: '1x', resourceLevel: 1, vcpus: 1 }

/**
 * Run a full analysis across both engines for multiple test snippets.
 *
 * @param {Array<{ code: string, title: string }>} tests
 * @param {object} opts
 * @param {string} [opts.setup] - Shared setup code
 * @param {string} [opts.teardown] - Shared teardown code
 * @param {number} [opts.timeMs=2000] - Benchmark time per engine per profile
 * @param {string} [opts.snapshotId] - Vercel Sandbox snapshot ID for fast boot
 * @param {AbortSignal} [opts.signal] - Abort signal
 * @param {(step: object) => void} [opts.onProgress] - Progress callback
 * @param {(tests: Array, opts: object) => Promise<Array|null|object>} [opts.estimateComplexities]
 *   Remote complexity estimator. Kept injectable so the runner never imports
 *   native parser dependencies in the Vercel app bundle.
 * @returns {Promise<object>} Full analysis results
 */
export async function runAnalysis(tests, {
  setup,
  teardown,
  timeMs = 2000,
  snapshotId,
  signal,
  onProgress,
  estimateComplexities,
} = {}) {
  if (!tests || tests.length === 0) {
    throw new Error('At least one test is required')
  }

  const [allQuickjsProfiles, allV8Profiles, complexities] = await Promise.all([
    runQuickJSAnalysis(tests, { setup, teardown, timeMs, signal, onProgress }),
    runV8Analysis(tests, { setup, teardown, timeMs, snapshotId, signal, onProgress }),
    runComplexityPhase(tests, { setup, signal, onProgress, estimateComplexities }),
  ])

  return buildAnalysisFromProfiles(tests, { quickjsProfiles: allQuickjsProfiles, v8Profiles: allV8Profiles, complexities, onProgress })
}

export function buildAnalysisFromProfiles(tests: any[], {
  quickjsProfiles: allQuickjsProfiles,
  v8Profiles: allV8Profiles,
  complexities = Array(tests.length).fill(null),
  onProgress,
}: any = {}) {
  const results = []
  for (let i = 0; i < tests.length; i++) {
    onProgress?.({ engine: 'prediction', testIndex: i, status: 'running' })

    const quickjsProfiles = allQuickjsProfiles[i]
    const v8Profiles = allV8Profiles[i]
    const prediction = buildPrediction({ quickjsProfiles, v8Profiles })

    const qjsAvgOps = average(quickjsProfiles.map(p => p.opsPerSec))
    const v8AvgOps = average(v8Profiles.map(p => p.opsPerSec))

    results.push({
      testIndex: i,
      title: tests[i].title,
      quickjs: { opsPerSec: qjsAvgOps, profiles: quickjsProfiles },
      v8: { opsPerSec: v8AvgOps, profiles: v8Profiles },
      prediction,
      complexity: complexities[i],
    })

    onProgress?.({ engine: 'prediction', testIndex: i, status: 'done' })
  }

  // Cross-test comparison
  const comparison = compareTests(
    results.map(r => ({
      quickjsOps: r.quickjs.opsPerSec,
      v8Ops: r.v8.opsPerSec,
    }))
  )

  const hasErrors = results.some(r =>
    r.v8.profiles.some(p => p.state === 'errored') ||
    (r.v8.opsPerSec === 0 && r.quickjs.profiles.some(p => p.state === 'errored'))
  )

  return { results, comparison, hasErrors }
}

export async function runQuickJSAnalysis(tests: any[], {
  setup,
  teardown,
  timeMs,
  signal,
  onProgress,
}: any = {}) {
  const allProfiles = []

  for (let i = 0; i < tests.length; i++) {
    throwIfAborted(signal)

    onProgress?.({ engine: 'quickjs', testIndex: i, status: 'running' })

    const profiles = []
    for (let profileIndex = 0; profileIndex < QUICKJS_MEMORY_PROFILES.length; profileIndex++) {
      const profile = QUICKJS_MEMORY_PROFILES[profileIndex]
      throwIfAborted(signal)

      const qjsResult = await runInQuickJS(tests[i].code, {
        setup,
        teardown,
        timeMs: Math.min(timeMs, 1500),
        memoryLimit: profile.memoryLimit,
        isAsync: isAsyncTest(tests[i]),
      })

      profiles.push({
        label: profile.label,
        resourceLevel: profile.resourceLevel,
        memoryMB: profile.memoryLimit / (1024 * 1024),
        opsPerSec: qjsResult.opsPerSec || 0,
        latency: qjsResult.latency || null,
        methodology: qjsResult.methodology || null,
        memoryUsed: qjsResult.memoryUsed,
        state: qjsResult.state,
        error: qjsResult.error,
      })
    }

    allProfiles.push(profiles)
    onProgress?.({ engine: 'quickjs', testIndex: i, status: 'done' })
  }

  return allProfiles
}

export async function runV8Analysis(tests: any[], {
  setup,
  teardown,
  timeMs,
  snapshotId,
  signal,
  onProgress,
}: any = {}) {
  const allProfiles = []

  for (let i = 0; i < tests.length; i++) {
    throwIfAborted(signal)

    onProgress?.({ engine: 'v8', testIndex: i, status: 'running' })

    const profile = V8_CANONICAL_PROFILE
    const v8Result = await runInV8Sandbox(tests[i].code, {
      setup,
      teardown,
      timeMs: Math.min(timeMs, 1500),
      snapshotId,
      vcpus: profile.vcpus,
      isAsync: isAsyncTest(tests[i]),
      signal,
    })

    allProfiles.push([{
      label: profile.label,
      resourceLevel: profile.resourceLevel,
      vcpus: profile.vcpus,
      opsPerSec: v8Result.opsPerSec || 0,
      latency: v8Result.latency || null,
      methodology: v8Result.methodology || null,
      heapUsed: v8Result.heapUsed || 0,
      state: v8Result.state,
      error: v8Result.error,
    }])

    onProgress?.({ engine: 'v8', testIndex: i, status: 'done' })
  }

  return allProfiles
}

async function runComplexityPhase(tests, {
  setup,
  signal,
  onProgress,
  estimateComplexities,
}) {
  let complexities = Array(tests.length).fill(null)
  if (!estimateComplexities) return complexities

  throwIfAborted(signal)
  for (let i = 0; i < tests.length; i++) {
    onProgress?.({ engine: 'complexity', testIndex: i, status: 'running' })
  }

  const remoteComplexities = await estimateComplexities(tests, { setup, signal })
  if (Array.isArray(remoteComplexities)) {
    complexities = remoteComplexities
  }

  throwIfAborted(signal)
  for (let i = 0; i < tests.length; i++) {
    onProgress?.({ engine: 'complexity', testIndex: i, status: 'done' })
  }

  return complexities
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function average(arr) {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}
