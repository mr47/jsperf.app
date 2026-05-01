import type { BenchmarkTestSource } from './types'
import {
  findAsyncNotAwaitedRisk,
  findBrowserApiUsage,
  findConstantFoldingRisk,
  findDeadCodeEliminationRisk,
  findSetupInMeasuredCodeRisk,
} from './detection'

export type BenchmarkDoctorCategory =
  | 'dead-code-elimination'
  | 'constant-folding'
  | 'setup-in-measured-code'
  | 'async-not-awaited'
  | 'browser-api-server-runtime'
  | 'high-variance'
  | 'winner-not-significant'

export type BenchmarkDoctorSeverity = 'info' | 'warning' | 'danger'
export type BenchmarkDoctorScope = 'run' | 'test'

export interface BenchmarkDoctorDiagnostic {
  id: string
  severity: BenchmarkDoctorSeverity
  category: BenchmarkDoctorCategory
  scope: BenchmarkDoctorScope
  testIndex?: number
  testTitle?: string
  title: string
  message: string
  evidence?: string
  recommendation: string
}

export interface BenchmarkDoctorSummary {
  total: number
  info: number
  warning: number
  danger: number
  verdict: 'clean' | 'review' | 'misleading'
}

export interface BenchmarkDoctorReport {
  diagnostics: BenchmarkDoctorDiagnostic[]
  summary: BenchmarkDoctorSummary
}

interface BuildBenchmarkDoctorInput {
  tests?: BenchmarkTestSource[]
  setup?: string
  teardown?: string
  results?: BenchmarkDoctorResult[]
}

interface BenchmarkDoctorResult {
  testIndex?: number
  title?: string
  quickjs?: EngineResult
  v8?: EngineResult
}

interface EngineResult {
  opsPerSec?: number
  profiles?: BenchmarkProfile[]
}

interface BenchmarkProfile {
  state?: string
  opsPerSec?: number
  latency?: {
    mean?: number
    moe?: number
    rme?: number
    samplesCount?: number
  } | null
}

interface Measurement {
  testIndex: number
  title: string
  opsPerSec: number
  latency: NonNullable<BenchmarkProfile['latency']>
  engine: 'v8' | 'quickjs'
}

const HIGH_RME = 10
const VERY_HIGH_RME = 25
const UNSTABLE_RME = 100
const MIN_SAMPLES = 5

export function buildBenchmarkDoctor({
  tests = [],
  setup = '',
  teardown = '',
  results = [],
}: BuildBenchmarkDoctorInput): BenchmarkDoctorReport {
  const diagnostics: BenchmarkDoctorDiagnostic[] = []

  for (let index = 0; index < tests.length; index++) {
    const test = tests[index]
    const testTitle = testTitleFor(test, index)

    const dceRisk = findDeadCodeEliminationRisk(test)
    if (dceRisk) {
      diagnostics.push({
        id: diagnosticId('dead-code-elimination', index),
        severity: 'warning',
        category: 'dead-code-elimination',
        scope: 'test',
        testIndex: index,
        testTitle,
        title: 'Result may be optimized away',
        message: 'This test appears to compute a value without returning it, storing it, or mutating shared state.',
        evidence: dceRisk.evidence,
        recommendation: 'Return the computed value, assign it to a shared sink, or mutate a setup value so the work stays observable.',
      })
    }

    const foldingRisk = findConstantFoldingRisk(test)
    if (foldingRisk) {
      diagnostics.push({
        id: diagnosticId('constant-folding', index),
        severity: 'warning',
        category: 'constant-folding',
        scope: 'test',
        testIndex: index,
        testTitle,
        title: 'Constant input can be folded',
        message: 'The measured expression appears to use only literal inputs, so an engine may precompute it.',
        evidence: foldingRisk.evidence,
        recommendation: 'Move inputs into setup variables and vary them enough that the runtime has to execute the work.',
      })
    }

    const setupRisk = findSetupInMeasuredCodeRisk(test)
    if (setupRisk) {
      diagnostics.push({
        id: diagnosticId('setup-in-measured-code', index),
        severity: 'info',
        category: 'setup-in-measured-code',
        scope: 'test',
        testIndex: index,
        testTitle,
        title: 'Setup work may be inside the timed body',
        message: 'The test body appears to allocate or initialize reusable data before doing the operation under test.',
        evidence: setupRisk.evidence,
        recommendation: 'Move reusable input construction to shared setup unless allocation is the thing being compared.',
      })
    }

    const asyncRisk = findAsyncNotAwaitedRisk(test)
    if (asyncRisk) {
      diagnostics.push({
        id: diagnosticId('async-not-awaited', index),
        severity: 'danger',
        category: 'async-not-awaited',
        scope: 'test',
        testIndex: index,
        testTitle,
        title: 'Async work may not be awaited',
        message: 'This snippet schedules or returns Promise-like work without a recognized async marker.',
        evidence: asyncRisk.evidence,
        recommendation: 'Use `await`, `return new Promise(...)`, `deferred.resolve(...)`, or mark the test as async so the harness waits for completion.',
      })
    }

    const browserApis = findBrowserApiUsage(test, { setup, teardown })
    if (browserApis.length > 0) {
      diagnostics.push({
        id: diagnosticId('browser-api-server-runtime', index),
        severity: 'warning',
        category: 'browser-api-server-runtime',
        scope: 'test',
        testIndex: index,
        testTitle,
        title: 'Server runtime comparison is not valid',
        message: 'This test or its shared setup touches browser-only APIs, so Node / Deno / Bun results are skipped or incomparable.',
        evidence: browserApis.slice(0, 5).join(', '),
        recommendation: 'Keep DOM and browser API benchmarks in the browser runner, or replace browser globals with runtime-neutral setup.',
      })
    }
  }

  diagnostics.push(...buildResultDiagnostics(results))

  const sorted = diagnostics.sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity)
    if (severityDiff !== 0) return severityDiff
    return (a.testIndex ?? -1) - (b.testIndex ?? -1)
  })

  return {
    diagnostics: sorted,
    summary: summarize(sorted),
  }
}

function buildResultDiagnostics(results: BenchmarkDoctorResult[]): BenchmarkDoctorDiagnostic[] {
  const diagnostics: BenchmarkDoctorDiagnostic[] = []
  const measurements = results.map(measurementForResult).filter(Boolean) as Measurement[]

  for (const measurement of measurements) {
    const rme = finiteNumber(measurement.latency.rme)
    const samples = finiteNumber(measurement.latency.samplesCount)

    if (rme != null && rme >= HIGH_RME) {
      const unstable = rme >= UNSTABLE_RME
      diagnostics.push({
        id: diagnosticId('high-variance', measurement.testIndex, measurement.engine),
        severity: rme >= VERY_HIGH_RME ? 'danger' : 'warning',
        category: 'high-variance',
        scope: 'test',
        testIndex: measurement.testIndex,
        testTitle: measurement.title,
        title: unstable ? 'Measurement is unstable' : 'High variance in measured samples',
        message: unstable
          ? `${measurement.engine.toUpperCase()} timing variation is larger than the measured mean, so this sample cannot support a reliable ranking.`
          : `${measurement.engine.toUpperCase()} reported a relative margin of error of ${formatPercent(rme)}, so small differences may be noise.`,
        evidence: `rme=${formatRmeEvidence(rme)}`,
        recommendation: unstable
          ? 'Make each operation heavier, increase benchmark duration, or add realistic input work before comparing this result.'
          : 'Increase benchmark duration, reduce background noise, or make each operation heavier before trusting close rankings.',
      })
    }

    if (samples != null && samples > 0 && samples < MIN_SAMPLES) {
      diagnostics.push({
        id: diagnosticId('high-variance', measurement.testIndex, `${measurement.engine}-samples`),
        severity: 'info',
        category: 'high-variance',
        scope: 'test',
        testIndex: measurement.testIndex,
        testTitle: measurement.title,
        title: 'Low sample count',
        message: `${measurement.engine.toUpperCase()} only produced ${samples} timing slices for this test.`,
        evidence: `samples=${samples}`,
        recommendation: 'Re-run with a longer measurement window if this result decides the winner.',
      })
    }
  }

  const winnerDiagnostic = buildWinnerConfidenceDiagnostic(measurements)
  if (winnerDiagnostic) diagnostics.push(winnerDiagnostic)

  return diagnostics
}

function buildWinnerConfidenceDiagnostic(measurements: Measurement[]): BenchmarkDoctorDiagnostic | null {
  if (measurements.length < 2) return null

  const ranked = [...measurements].sort((a, b) => b.opsPerSec - a.opsPerSec)
  const fastest = ranked[0]
  const second = ranked[1]
  const fastestMean = finiteNumber(fastest.latency.mean)
  const fastestMoe = finiteNumber(fastest.latency.moe)
  const secondMean = finiteNumber(second.latency.mean)
  const secondMoe = finiteNumber(second.latency.moe)

  if (fastestMean == null || fastestMoe == null || secondMean == null || secondMoe == null) {
    return null
  }

  const fastestUpper = fastestMean + fastestMoe
  const secondLower = Math.max(0, secondMean - secondMoe)
  if (fastestUpper < secondLower) return null

  return {
    id: 'winner-not-significant:run',
    severity: 'warning',
    category: 'winner-not-significant',
    scope: 'run',
    title: 'Winner is within the margin of error',
    message: `${fastest.title} ranks first, but its confidence interval overlaps with ${second.title}.`,
    evidence: `${fastest.title}: ${formatLatencyInterval(fastest)}; ${second.title}: ${formatLatencyInterval(second)}`,
    recommendation: 'Treat these tests as tied until a longer or heavier benchmark separates their confidence intervals.',
  }
}

function measurementForResult(result: BenchmarkDoctorResult): Measurement | null {
  if (!result) return null

  const testIndex = Number.isFinite(result.testIndex) ? Number(result.testIndex) : 0
  const title = result.title || `Test ${testIndex + 1}`
  const v8 = firstCompletedProfile(result.v8?.profiles)
  if (v8?.latency && finiteNumber(v8.opsPerSec) != null) {
    return { testIndex, title, opsPerSec: Number(v8.opsPerSec), latency: v8.latency, engine: 'v8' }
  }

  const quickjs = firstCompletedProfile(result.quickjs?.profiles)
  if (quickjs?.latency && finiteNumber(quickjs.opsPerSec) != null) {
    return { testIndex, title, opsPerSec: Number(quickjs.opsPerSec), latency: quickjs.latency, engine: 'quickjs' }
  }

  return null
}

function firstCompletedProfile(profiles?: BenchmarkProfile[]): BenchmarkProfile | null {
  if (!Array.isArray(profiles)) return null
  return profiles.find(profile => profile?.state === 'completed' && Number(profile.opsPerSec) > 0 && profile.latency) || null
}

function summarize(diagnostics: BenchmarkDoctorDiagnostic[]): BenchmarkDoctorSummary {
  const summary = diagnostics.reduce((acc, diagnostic) => {
    acc[diagnostic.severity] += 1
    return acc
  }, { info: 0, warning: 0, danger: 0 })

  return {
    total: diagnostics.length,
    info: summary.info,
    warning: summary.warning,
    danger: summary.danger,
    verdict: summary.danger > 0 ? 'misleading' : summary.warning > 0 ? 'review' : 'clean',
  }
}

function diagnosticId(category: BenchmarkDoctorCategory, testIndex: number, suffix?: string): string {
  return `${category}:test-${testIndex}${suffix ? `:${suffix}` : ''}`
}

function testTitleFor(test: BenchmarkTestSource, index: number): string {
  return typeof test?.title === 'string' && test.title.trim()
    ? test.title.trim()
    : `Test ${index + 1}`
}

function severityRank(severity: BenchmarkDoctorSeverity): number {
  if (severity === 'danger') return 3
  if (severity === 'warning') return 2
  return 1
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`
}

function formatRmeEvidence(value: number): string {
  return value >= UNSTABLE_RME ? `>${UNSTABLE_RME}%` : formatPercent(value)
}

function formatLatencyInterval(measurement: Measurement): string {
  const mean = Number(measurement.latency.mean)
  const moe = Number(measurement.latency.moe)
  return `${formatMs(mean)} +/- ${formatMs(moe)}`
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return 'unknown'
  if (value < 0.001) return `${(value * 1_000_000).toFixed(0)}ns`
  if (value < 1) return `${(value * 1000).toFixed(2)}us`
  return `${value.toFixed(2)}ms`
}
