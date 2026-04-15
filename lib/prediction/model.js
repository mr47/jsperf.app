/**
 * Prediction model for benchmark scaling analysis.
 *
 * Takes results from multiple resource profiles across two engines
 * (QuickJS-WASM deterministic + V8 JIT realistic) and produces:
 *   - Scaling type classification (linear, sublinear, plateau, degrading)
 *   - JIT amplification ratio (how much V8 JIT helps vs interpreter)
 *   - Resource sensitivity analysis
 *   - Predicted ops/sec at higher resource levels
 *   - Code characteristic badges (CPU-bound, memory-bound, JIT-friendly, etc.)
 */

import { bestFit, linearRegression } from './regression.js'

/**
 * Build a complete prediction from dual-engine profile results.
 *
 * @param {object} params
 * @param {Array<{ label: string, resourceLevel: number, opsPerSec: number }>} params.quickjsProfiles
 * @param {Array<{ label: string, resourceLevel: number, opsPerSec: number, heapUsed?: number }>} params.v8Profiles
 * @returns {object} prediction
 */
export function buildPrediction({ quickjsProfiles, v8Profiles }) {
  const qjsOps = quickjsProfiles.length > 0
    ? quickjsProfiles.reduce((sum, p) => sum + p.opsPerSec, 0) / quickjsProfiles.length
    : 0
  const v8Ops = v8Profiles.length > 0
    ? v8Profiles.reduce((sum, p) => sum + p.opsPerSec, 0) / v8Profiles.length
    : 0

  const v8Available = v8Profiles.some(p => p.opsPerSec > 0)
  const jitBenefit = qjsOps > 0 && v8Available ? v8Ops / qjsOps : 0

  // Prefer V8 profiles for scaling, fall back to QuickJS when V8 is unavailable
  const scalingSource = v8Available ? v8Profiles : quickjsProfiles
  const scalingData = scalingSource
    .filter(p => p.resourceLevel > 0 && p.opsPerSec > 0)
    .map(p => [p.resourceLevel, p.opsPerSec])

  const scaling = analyzeScaling(scalingData)
  const memSensitivity = v8Available
    ? analyzeMemorySensitivity(v8Profiles)
    : analyzeQuickJSMemorySensitivity(quickjsProfiles)
  const characteristics = classifyCharacteristics({ jitBenefit, scaling, memSensitivity, v8Available })

  const predictedAt = {}
  if (scaling.predict) {
    for (const level of [1, 2, 4, 8]) {
      predictedAt[`${level}x`] = Math.max(0, Math.round(scaling.predict(level)))
    }
  }

  return {
    scalingType: scaling.type,
    scalingConfidence: scaling.rSquared,
    jitBenefit: Math.round(jitBenefit * 10) / 10,
    memSensitivity,
    predictedAt,
    characteristics,
  }
}

/**
 * Analyze how ops/sec scales with resource level.
 *
 * @param {number[][]} points - Array of [resourceLevel, opsPerSec]
 * @returns {{ type: string, rSquared: number, predict: Function | null }}
 */
function analyzeScaling(points) {
  if (points.length < 2) {
    return { type: 'insufficient-data', rSquared: 0, predict: null }
  }

  const fit = bestFit(points)

  if (fit.rSquared < 0.5) {
    return { type: 'noisy', rSquared: fit.rSquared, predict: fit.predict }
  }

  if (fit.type === 'linear') {
    const { slope, intercept } = fit.params
    const baseOps = slope * points[0][0] + intercept
    if (baseOps <= 0) return { type: 'linear', rSquared: fit.rSquared, predict: fit.predict }

    const relativeSlope = slope / baseOps
    if (relativeSlope > 0.7) return { type: 'linear', rSquared: fit.rSquared, predict: fit.predict }
    if (relativeSlope > 0.3) return { type: 'sublinear', rSquared: fit.rSquared, predict: fit.predict }
    if (relativeSlope > -0.1) return { type: 'plateau', rSquared: fit.rSquared, predict: fit.predict }
    return { type: 'degrading', rSquared: fit.rSquared, predict: fit.predict }
  }

  if (fit.type === 'logarithmic') {
    return { type: 'sublinear', rSquared: fit.rSquared, predict: fit.predict }
  }

  const { b } = fit.params
  if (b >= 0.8) return { type: 'linear', rSquared: fit.rSquared, predict: fit.predict }
  if (b >= 0.3) return { type: 'sublinear', rSquared: fit.rSquared, predict: fit.predict }
  if (b >= -0.1) return { type: 'plateau', rSquared: fit.rSquared, predict: fit.predict }
  return { type: 'degrading', rSquared: fit.rSquared, predict: fit.predict }
}

/**
 * Analyze how ops/sec changes with heap usage across profiles.
 *
 * @param {Array<{ heapUsed?: number, opsPerSec: number }>} profiles
 * @returns {number} sensitivity coefficient (-1 to 1)
 */
function analyzeMemorySensitivity(profiles) {
  const withHeap = profiles.filter(p => p.heapUsed != null && p.heapUsed > 0 && p.opsPerSec > 0)
  if (withHeap.length < 2) return 0

  const points = withHeap.map(p => [p.heapUsed, p.opsPerSec])
  const { slope, intercept } = linearRegression(points)

  const meanOps = points.reduce((s, [, y]) => s + y, 0) / points.length
  if (meanOps === 0) return 0

  return Math.max(-1, Math.min(1, (slope * (points[points.length - 1][0] - points[0][0])) / meanOps))
}

/**
 * Approximate memory sensitivity from QuickJS profiles when V8 data is unavailable.
 * Uses totalBytes from QuickJS memory usage as proxy for heap pressure.
 */
function analyzeQuickJSMemorySensitivity(profiles) {
  const withMem = profiles.filter(p =>
    p.memoryUsed?.totalBytes > 0 && p.opsPerSec > 0
  )
  if (withMem.length < 2) return 0

  const points = withMem.map(p => [p.memoryUsed.totalBytes, p.opsPerSec])
  const { slope } = linearRegression(points)

  const meanOps = points.reduce((s, [, y]) => s + y, 0) / points.length
  if (meanOps === 0) return 0

  return Math.max(-1, Math.min(1, (slope * (points[points.length - 1][0] - points[0][0])) / meanOps))
}

/**
 * Classify code characteristics from analysis data.
 *
 * @param {{ jitBenefit: number, scaling: object, memSensitivity: number, v8Available: boolean }} data
 * @returns {{ cpuBound: boolean, memoryBound: boolean, allocationHeavy: boolean, jitFriendly: boolean, v8Unavailable: boolean }}
 */
function classifyCharacteristics({ jitBenefit, scaling, memSensitivity, v8Available = true }) {
  return {
    cpuBound: scaling.type === 'linear' || scaling.type === 'sublinear',
    memoryBound: scaling.type === 'plateau' || scaling.type === 'degrading',
    allocationHeavy: memSensitivity < -0.3,
    jitFriendly: v8Available && jitBenefit > 10,
    v8Unavailable: !v8Available,
  }
}

/**
 * Compare multiple tests and identify divergence between
 * algorithmic (QuickJS) and runtime (V8) winners.
 *
 * @param {Array<{ quickjsOps: number, v8Ops: number }>} tests
 * @returns {{ fastestByAlgorithm: number, fastestByRuntime: number, divergence: boolean }}
 */
export function compareTests(tests) {
  if (tests.length === 0) {
    return { fastestByAlgorithm: -1, fastestByRuntime: -1, divergence: false }
  }

  let fastestByAlgorithm = 0
  let fastestByRuntime = 0

  for (let i = 1; i < tests.length; i++) {
    if (tests[i].quickjsOps > tests[fastestByAlgorithm].quickjsOps) {
      fastestByAlgorithm = i
    }
    if (tests[i].v8Ops > tests[fastestByRuntime].v8Ops) {
      fastestByRuntime = i
    }
  }

  return {
    fastestByAlgorithm,
    fastestByRuntime,
    divergence: fastestByAlgorithm !== fastestByRuntime,
  }
}
