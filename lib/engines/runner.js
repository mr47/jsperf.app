/**
 * Multi-engine benchmark orchestrator.
 *
 * Runs benchmark code through both QuickJS-WASM (deterministic) and
 * V8 Sandbox (realistic JIT) engines, then builds a prediction model
 * from the combined results.
 */

import { runInQuickJS } from './quickjs.js'
import { runInV8Sandbox } from './v8sandbox.js'
import { buildPrediction, compareTests } from '../prediction/model.js'

const RESOURCE_PROFILES = [
  { label: '1x', resourceLevel: 1, memoryLimit: 16 * 1024 * 1024, vcpus: 1 },
  { label: '2x', resourceLevel: 2, memoryLimit: 32 * 1024 * 1024, vcpus: 1 },
  { label: '4x', resourceLevel: 4, memoryLimit: 64 * 1024 * 1024, vcpus: 1 },
  { label: '8x', resourceLevel: 8, memoryLimit: 128 * 1024 * 1024, vcpus: 1 },
]

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
 * @returns {Promise<object>} Full analysis results
 */
export async function runAnalysis(tests, {
  setup,
  teardown,
  timeMs = 2000,
  snapshotId,
  signal,
  onProgress,
} = {}) {
  if (!tests || tests.length === 0) {
    throw new Error('At least one test is required')
  }

  const allQuickjsProfiles = []
  const allV8Profiles = []

  // Phase 1: QuickJS-WASM for all tests
  for (let i = 0; i < tests.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    onProgress?.({ engine: 'quickjs', testIndex: i, status: 'running' })

    const profiles = []
    for (const profile of RESOURCE_PROFILES) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const qjsResult = await runInQuickJS(tests[i].code, {
        setup,
        teardown,
        timeMs: Math.min(timeMs, 1500),
        memoryLimit: profile.memoryLimit,
      })

      profiles.push({
        label: profile.label,
        resourceLevel: profile.resourceLevel,
        memoryMB: profile.memoryLimit / (1024 * 1024),
        opsPerSec: qjsResult.opsPerSec || 0,
        memoryUsed: qjsResult.memoryUsed,
        state: qjsResult.state,
        error: qjsResult.error,
      })
    }

    allQuickjsProfiles.push(profiles)
    onProgress?.({ engine: 'quickjs', testIndex: i, status: 'done' })
  }

  // Phase 2: V8 Sandbox for all tests
  for (let i = 0; i < tests.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    onProgress?.({ engine: 'v8', testIndex: i, status: 'running' })

    const profiles = []
    for (const profile of RESOURCE_PROFILES) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const v8Result = await runInV8Sandbox(tests[i].code, {
        setup,
        teardown,
        timeMs: Math.min(timeMs, 1500),
        snapshotId,
        vcpus: profile.vcpus,
      })

      profiles.push({
        label: profile.label,
        resourceLevel: profile.resourceLevel,
        memoryMB: profile.memoryLimit / (1024 * 1024),
        opsPerSec: v8Result.opsPerSec || 0,
        heapUsed: v8Result.heapUsed || 0,
        state: v8Result.state,
        error: v8Result.error,
      })
    }

    allV8Profiles.push(profiles)
    onProgress?.({ engine: 'v8', testIndex: i, status: 'done' })
  }

  // Phase 3: Build predictions for all tests
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
      quickjs: {
        opsPerSec: qjsAvgOps,
        profiles: quickjsProfiles,
      },
      v8: {
        opsPerSec: v8AvgOps,
        profiles: v8Profiles,
      },
      prediction,
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
    r.quickjs.profiles.some(p => p.state === 'errored') ||
    r.v8.profiles.some(p => p.state === 'errored')
  )

  return { results, comparison, hasErrors }
}

function average(arr) {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}
