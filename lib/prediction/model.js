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

const PREDICTION_LEVELS = [1, 2, 4, 8]
const MIN_SCALING_CONFIDENCE = 0.5
const LEVEL_MATCH_EPSILON = 1e-9

/**
 * Build a complete prediction from dual-engine profile results.
 *
 * @param {object} params
 * @param {Array<{ label: string, resourceLevel: number, opsPerSec: number }>} params.quickjsProfiles
 * @param {Array<{ label: string, resourceLevel: number, opsPerSec: number, heapUsed?: number }>} params.v8Profiles
 * @returns {object} prediction
 */
export function buildPrediction({ quickjsProfiles, v8Profiles }) {
  quickjsProfiles = asArray(quickjsProfiles)
  v8Profiles = asArray(v8Profiles)

  const v8Available = v8Profiles.some(p => isPositiveFiniteNumber(p?.opsPerSec))
  const jitBenefit = computeJitBenefit(quickjsProfiles, v8Profiles)

  // Prefer V8 profiles for scaling, fall back to QuickJS when V8 is unavailable
  const scalingSource = v8Available ? v8Profiles : quickjsProfiles
  const scalingData = buildScalingPoints(scalingSource)

  const scaling = analyzeScaling(scalingData)
  const memSensitivity = v8Available
    ? analyzeMemorySensitivity(v8Profiles)
    : analyzeQuickJSMemorySensitivity(quickjsProfiles)
  const characteristics = classifyCharacteristics({ jitBenefit, scaling, memSensitivity, v8Available })

  const predictedAt = {}
  if (scaling.predict) {
    for (const level of PREDICTION_LEVELS) {
      predictedAt[`${level}x`] = predictAtLevel(level, scalingData, scaling.predict)
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

  if (fit.rSquared < MIN_SCALING_CONFIDENCE) {
    return { type: 'noisy', rSquared: fit.rSquared, predict: fit.predict }
  }

  return { type: classifyScalingType(fit, points), rSquared: fit.rSquared, predict: fit.predict }
}

/**
 * Analyze how ops/sec changes with heap usage across profiles.
 *
 * @param {Array<{ heapUsed?: number, opsPerSec: number }>} profiles
 * @returns {number} sensitivity coefficient (-1 to 1)
 */
function analyzeMemorySensitivity(profiles) {
  const points = asArray(profiles)
    .filter(p => isPositiveFiniteNumber(p?.heapUsed) && isPositiveFiniteNumber(p?.opsPerSec))
    .map(p => [p.heapUsed, p.opsPerSec])

  return computeSensitivity(points)
}

/**
 * Approximate memory sensitivity from QuickJS profiles when V8 data is unavailable.
 * Uses totalBytes from QuickJS memory usage as proxy for heap pressure.
 */
function analyzeQuickJSMemorySensitivity(profiles) {
  const points = asArray(profiles)
    .filter(p => isPositiveFiniteNumber(p?.memoryUsed?.totalBytes) && isPositiveFiniteNumber(p?.opsPerSec))
    .map(p => [p.memoryUsed.totalBytes, p.opsPerSec])

  return computeSensitivity(points)
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
 * Build a cross-runtime ranking + scaling summary from multi-runtime data.
 *
 * Input shape (one entry per runtime):
 *   { node: { profiles: [...], avgOpsPerSec, error }, deno: {...}, bun: {...} }
 *
 * Each profile carries { resourceLevel, opsPerSec, perfCounters, ... }.
 *
 * @param {object} runtimes
 * @returns {object|null}
 */
export function buildRuntimeComparison(runtimes) {
  if (!runtimes || typeof runtimes !== 'object') return null

  const entries = Object.entries(runtimes).map(([name, data]) => {
    const profiles = (data && data.profiles) || []
    const validProfiles = profiles.filter(p => isPositiveFiniteNumber(p?.opsPerSec))
    const avg = validProfiles.length > 0
      ? validProfiles.reduce((s, p) => s + p.opsPerSec, 0) / validProfiles.length
      : 0

    const scalingPoints = buildScalingPoints(validProfiles)

    let scalingType = 'insufficient-data'
    let scalingRSquared = 0
    if (scalingPoints.length >= 2) {
      const fit = bestFit(scalingPoints)
      scalingRSquared = fit.rSquared
      scalingType = classifyScalingType(fit, scalingPoints)
    }

    return {
      runtime: name,
      runtimeName: data?.runtime || runtimeBaseName(name),
      version: data?.version || runtimeVersion(name),
      label: data?.label || null,
      avgOpsPerSec: Math.round(avg),
      profiles: profiles.map(p => ({
        label: p.label,
        resourceLevel: p.resourceLevel,
        opsPerSec: p.opsPerSec || 0,
        cpus: p.cpus,
        memMb: p.memMb,
        state: p.state,
        latencyMean: p.latency?.mean ?? null,
        latencyP99: p.latency?.p99 ?? null,
        rss: p.memory?.after?.rss ?? null,
        heapUsed: p.memory?.after?.heapUsed ?? null,
        perfCounters: p.perfCounters || null,
      })),
      scalingType,
      scalingConfidence: Number.isFinite(scalingRSquared) ? scalingRSquared : 0,
      hasError: Boolean(data?.error) || profiles.every(p => p.state === 'errored'),
      error: data?.error || null,
    }
  })

  const ranked = entries
    .filter(e => !e.hasError && e.avgOpsPerSec > 0)
    .sort((a, b) => b.avgOpsPerSec - a.avgOpsPerSec)

  const fastestRuntime = ranked[0]?.runtime || null
  const slowestRuntime = ranked.length > 0 ? ranked[ranked.length - 1].runtime : null
  const spread = ranked.length >= 2 && ranked[ranked.length - 1].avgOpsPerSec > 0
    ? ranked[0].avgOpsPerSec / ranked[ranked.length - 1].avgOpsPerSec
    : 0

  return {
    runtimes: entries,
    ranking: ranked.map(r => ({ runtime: r.runtime, avgOpsPerSec: r.avgOpsPerSec })),
    fastestRuntime,
    slowestRuntime,
    spread: Math.round(spread * 100) / 100,
    available: ranked.length > 0,
  }
}

function runtimeBaseName(runtimeId) {
  return typeof runtimeId === 'string' ? runtimeId.split('@')[0] : ''
}

function runtimeVersion(runtimeId) {
  if (typeof runtimeId !== 'string') return null
  const marker = runtimeId.indexOf('@')
  return marker === -1 ? null : runtimeId.slice(marker + 1)
}

function classifyScalingType(fit, points) {
  if (fit.rSquared < MIN_SCALING_CONFIDENCE) return 'noisy'

  const elasticity = scalingElasticity(points)
  if (elasticity != null) return classifyElasticity(elasticity)

  if (fit.type === 'linear') {
    const { slope, intercept } = fit.params
    const baseOps = slope * points[0][0] + intercept
    if (baseOps <= 0) return 'linear'
    const relativeSlope = slope / baseOps
    if (relativeSlope > 0.7) return 'linear'
    if (relativeSlope > 0.3) return 'sublinear'
    if (relativeSlope > -0.1) return 'plateau'
    return 'degrading'
  }
  if (fit.type === 'logarithmic') return 'sublinear'
  const { b } = fit.params
  return classifyElasticity(b)
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

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint]
}

function buildScalingPoints(profiles) {
  const opsByLevel = new Map()

  for (const profile of asArray(profiles)) {
    if (!profile) continue
    const { resourceLevel, opsPerSec } = profile
    if (!isPositiveFiniteNumber(resourceLevel) || !isPositiveFiniteNumber(opsPerSec)) continue
    const values = opsByLevel.get(resourceLevel) || []
    values.push(opsPerSec)
    opsByLevel.set(resourceLevel, values)
  }

  return [...opsByLevel.entries()]
    .map(([level, values]) => [level, median(values)])
    .sort((a, b) => a[0] - b[0])
}

function computeJitBenefit(quickjsProfiles, v8Profiles) {
  const quickjsByLevel = new Map(buildScalingPoints(quickjsProfiles))
  const v8ByLevel = new Map(buildScalingPoints(v8Profiles))
  const matchedRatios = []

  for (const [level, v8Ops] of v8ByLevel) {
    const quickjsOps = quickjsByLevel.get(level)
    if (isPositiveFiniteNumber(quickjsOps)) matchedRatios.push(v8Ops / quickjsOps)
  }

  if (matchedRatios.length > 0) {
    return Math.exp(mean(matchedRatios.map(Math.log)))
  }

  const quickjsOps = averagePositiveOps(quickjsProfiles)
  const v8Ops = averagePositiveOps(v8Profiles)
  return quickjsOps > 0 && v8Ops > 0 ? v8Ops / quickjsOps : 0
}

function averagePositiveOps(profiles) {
  const values = asArray(profiles)
    .map(profile => profile?.opsPerSec)
    .filter(isPositiveFiniteNumber)

  return values.length > 0 ? mean(values) : 0
}

function predictAtLevel(level, observedPoints, predict) {
  const observed = observedPoints.find(([observedLevel]) =>
    Math.abs(observedLevel - level) < LEVEL_MATCH_EPSILON
  )
  const value = observed ? observed[1] : predict(level)

  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function computeSensitivity(points) {
  points = points
    .filter(([x, y]) => isPositiveFiniteNumber(x) && isPositiveFiniteNumber(y))
    .sort((a, b) => a[0] - b[0])

  if (points.length < 2) return 0

  const { slope } = linearRegression(points)
  const span = points[points.length - 1][0] - points[0][0]
  if (span <= 0) return 0

  const meanOps = mean(points.map(([, y]) => y))
  if (meanOps === 0) return 0

  return Math.max(-1, Math.min(1, (slope * span) / meanOps))
}

function scalingElasticity(points) {
  if (points.length < 2) return null

  const sorted = [...points].sort((a, b) => a[0] - b[0])
  const [firstLevel, firstOps] = sorted[0]
  const [lastLevel, lastOps] = sorted[sorted.length - 1]

  if (lastLevel <= firstLevel || firstOps <= 0 || lastOps <= 0) return null
  return Math.log(lastOps / firstOps) / Math.log(lastLevel / firstLevel)
}

function classifyElasticity(elasticity) {
  if (elasticity >= 0.8) return 'linear'
  if (elasticity >= 0.3) return 'sublinear'
  if (elasticity >= -0.1) return 'plateau'
  return 'degrading'
}
