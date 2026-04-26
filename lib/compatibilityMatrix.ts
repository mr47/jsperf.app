export type CompatibilityCellState = 'ok' | 'pending' | 'failed' | 'unsupported' | 'no-data'
export type CompatibilityCellComparison = 'wins' | 'loses' | 'irrelevant' | 'neutral' | 'single' | 'unavailable'
export type CompatibilityEnvironmentGroupKey = 'browser' | 'runtime' | 'baseline'

export type CompatibilityEnvironment = {
  key: string
  label: string
  shortLabel: string
  group: CompatibilityEnvironmentGroupKey
  engine: string
}

export type CompatibilityEnvironmentGroup = {
  key: CompatibilityEnvironmentGroupKey
  label: string
  description: string
  environments: CompatibilityEnvironment[]
}

export type CompatibilityCell = {
  environmentKey: string
  state: CompatibilityCellState
  comparison: CompatibilityCellComparison
  opsPerSec: number | null
  reason: string | null
  count?: number
  label?: string | null
}

export type CompatibilityTestRow = {
  testIndex: number
  title: string
  cells: CompatibilityCell[]
  insight: string
}

export type CompatibilityMatrix = {
  environmentGroups: CompatibilityEnvironmentGroup[]
  environments: CompatibilityEnvironment[]
  tests: CompatibilityTestRow[]
}

type BuildCompatibilityMatrixInput = {
  results?: any[]
  browserStats?: Record<string, any[]> | null
  multiRuntimeStatus?: string | null
  multiRuntimeError?: string | null
}

const COMPARISON_TOLERANCE = 0.05

export const COMPATIBILITY_ENVIRONMENT_GROUPS: CompatibilityEnvironmentGroup[] = [
  {
    key: 'browser',
    label: 'Browsers',
    description: 'Saved runs from real Chrome, Firefox, and Safari clients.',
    environments: [
      { key: 'chrome', label: 'Chrome', shortLabel: 'Chrome', group: 'browser', engine: 'Blink/V8' },
      { key: 'firefox', label: 'Firefox', shortLabel: 'Firefox', group: 'browser', engine: 'SpiderMonkey' },
      { key: 'safari', label: 'Safari', shortLabel: 'Safari', group: 'browser', engine: 'WebKit/JSC' },
    ],
  },
  {
    key: 'runtime',
    label: 'Server runtimes',
    description: 'Container worker results under matched CPU and memory limits.',
    environments: [
      { key: 'node', label: 'Node.js', shortLabel: 'Node', group: 'runtime', engine: 'V8' },
      { key: 'deno', label: 'Deno', shortLabel: 'Deno', group: 'runtime', engine: 'V8' },
      { key: 'bun', label: 'Bun', shortLabel: 'Bun', group: 'runtime', engine: 'JSC' },
    ],
  },
  {
    key: 'baseline',
    label: 'Baselines',
    description: 'Interpreter and isolated V8 reference points from deep analysis.',
    environments: [
      { key: 'quickjs', label: 'QuickJS no-JIT', shortLabel: 'QuickJS', group: 'baseline', engine: 'QuickJS' },
      { key: 'v8', label: 'V8 isolated sandbox', shortLabel: 'V8 sandbox', group: 'baseline', engine: 'V8' },
    ],
  },
]

export const COMPATIBILITY_ENVIRONMENTS: CompatibilityEnvironment[] =
  COMPATIBILITY_ENVIRONMENT_GROUPS.flatMap(group => group.environments)

export function buildCompatibilityMatrix({
  results = [],
  browserStats = null,
  multiRuntimeStatus = null,
  multiRuntimeError = null,
}: BuildCompatibilityMatrixInput): CompatibilityMatrix {
  const rows = asArray(results).map((result, index) => {
    const testIndex = Number.isInteger(result?.testIndex) ? result.testIndex : index
    const browserBuckets = aggregateBrowserBuckets(browserStats?.[testIndex] || browserStats?.[String(testIndex)])
    const cells = COMPATIBILITY_ENVIRONMENTS.map((environment) => {
      if (environment.group === 'browser') return browserCell(environment.key, browserBuckets)
      if (environment.key === 'quickjs') return engineCell('quickjs', result?.quickjs)
      if (environment.key === 'v8') return engineCell('v8', result?.v8)
      return runtimeCell(environment.key, result, multiRuntimeStatus, multiRuntimeError)
    })

    return {
      testIndex,
      title: result?.title || `Test ${testIndex + 1}`,
      cells,
      insight: '',
    }
  })

  annotateComparisons(rows)

  return {
    environmentGroups: COMPATIBILITY_ENVIRONMENT_GROUPS,
    environments: COMPATIBILITY_ENVIRONMENTS,
    tests: rows.map(row => ({
      ...row,
      insight: buildInsight(row),
    })),
  }
}

function aggregateBrowserBuckets(stats: any[] | undefined) {
  const buckets = new Map<string, { opsTotal: number, count: number }>()
  for (const stat of asArray(stats)) {
    const bucket = browserBucket(stat?.browserName)
    const avgOps = Number(stat?.avgOps)
    const count = Math.max(1, Number(stat?.count) || 1)
    if (!bucket || !isPositiveFiniteNumber(avgOps)) continue

    const current = buckets.get(bucket) || { opsTotal: 0, count: 0 }
    current.opsTotal += avgOps * count
    current.count += count
    buckets.set(bucket, current)
  }

  return buckets
}

function browserCell(environmentKey: string, buckets: Map<string, { opsTotal: number, count: number }>): CompatibilityCell {
  const bucket = buckets.get(environmentKey)
  if (!bucket || bucket.count <= 0) {
    return unavailableCell(
      environmentKey,
      'no-data',
      `No ${environmentLabel(environmentKey)} browser runs saved for this revision yet.`,
    )
  }

  return {
    environmentKey,
    state: 'ok',
    comparison: 'neutral',
    opsPerSec: Math.round(bucket.opsTotal / bucket.count),
    count: bucket.count,
    reason: null,
  }
}

function engineCell(environmentKey: 'quickjs' | 'v8', engine: any): CompatibilityCell {
  const opsPerSec = positiveOps(engine?.opsPerSec) || averagePositiveOps(engine?.profiles)
  if (opsPerSec > 0) {
    return {
      environmentKey,
      state: 'ok',
      comparison: 'neutral',
      opsPerSec: Math.round(opsPerSec),
      reason: null,
    }
  }

  const profile = firstNonCompletedProfile(engine?.profiles)
  const state = profile?.state === 'unsupported' ? 'unsupported' : profile?.state ? 'failed' : 'no-data'
  return unavailableCell(environmentKey, state, profile?.error || defaultEngineReason(environmentKey, state))
}

function runtimeCell(
  environmentKey: string,
  result: any,
  multiRuntimeStatus?: string | null,
  multiRuntimeError?: string | null,
): CompatibilityCell {
  const entries = asArray(result?.runtimeComparison?.runtimes)
    .filter(entry => runtimeBase(entry) === environmentKey)

  const usable = entries
    .filter(entry => !entry?.hasError && positiveOps(entry?.avgOpsPerSec) > 0)
    .sort((a, b) => Number(b.avgOpsPerSec) - Number(a.avgOpsPerSec))

  if (usable.length > 0) {
    const best = usable[0]
    return {
      environmentKey,
      state: 'ok',
      comparison: 'neutral',
      opsPerSec: Math.round(best.avgOpsPerSec),
      label: best.label || runtimeLabel(best),
      reason: null,
    }
  }

  const failed = entries.find(entry => entry?.hasError || entry?.error)
  if (failed) {
    return unavailableCell(
      environmentKey,
      'failed',
      failed.error || 'Runtime returned no successful benchmark profiles.',
      { label: failed.label || runtimeLabel(failed) },
    )
  }

  if (result?.multiRuntimeError) {
    return unavailableCell(environmentKey, 'failed', result.multiRuntimeError)
  }

  if (multiRuntimeStatus === 'pending') {
    return unavailableCell(
      environmentKey,
      'pending',
      `${environmentLabel(environmentKey)} is still running on the container worker.`,
    )
  }

  if (multiRuntimeStatus === 'errored') {
    return unavailableCell(
      environmentKey,
      'failed',
      multiRuntimeError || 'Multi-runtime worker failed before returning a result.',
    )
  }

  if (multiRuntimeStatus === 'unavailable') {
    return unavailableCell(
      environmentKey,
      'no-data',
      multiRuntimeError || 'Multi-runtime worker is not configured or is unreachable.',
    )
  }

  return unavailableCell(
    environmentKey,
    'no-data',
    `No ${environmentLabel(environmentKey)} result returned yet.`,
  )
}

function unavailableCell(
  environmentKey: string,
  state: Exclude<CompatibilityCellState, 'ok'>,
  reason: string,
  extra: Partial<CompatibilityCell> = {},
): CompatibilityCell {
  return {
    environmentKey,
    state,
    comparison: 'unavailable',
    opsPerSec: null,
    reason,
    ...extra,
  }
}

function annotateComparisons(rows: Array<{ cells: CompatibilityCell[] }>) {
  for (const environment of COMPATIBILITY_ENVIRONMENTS) {
    const cells = rows
      .map(row => row.cells.find(cell => cell.environmentKey === environment.key))
      .filter(Boolean) as CompatibilityCell[]
    const valid = cells.filter(cell => cell.state === 'ok' && isPositiveFiniteNumber(cell.opsPerSec))

    if (valid.length < 2) {
      for (const cell of valid) cell.comparison = 'single'
      continue
    }

    const values = valid.map(cell => cell.opsPerSec as number)
    const max = Math.max(...values)
    const min = Math.min(...values)
    if (min <= 0) continue

    if ((max - min) / max <= COMPARISON_TOLERANCE) {
      for (const cell of valid) cell.comparison = 'irrelevant'
      continue
    }

    for (const cell of valid) {
      const value = cell.opsPerSec as number
      if (value >= max * (1 - COMPARISON_TOLERANCE)) cell.comparison = 'wins'
      else if (value <= min * (1 + COMPARISON_TOLERANCE)) cell.comparison = 'loses'
      else cell.comparison = 'neutral'
    }
  }
}

function buildInsight(row: { title: string, cells: CompatibilityCell[] }) {
  const wins = labelsForComparison(row.cells, 'wins')
  const loses = labelsForComparison(row.cells, 'loses')
  const irrelevant = labelsForComparison(row.cells, 'irrelevant')
  const failures = row.cells
    .filter(cell => cell.state === 'failed' || cell.state === 'unsupported')
    .map(cell => `${environmentLabel(cell.environmentKey)}: ${cell.reason || cell.state}`)

  const clauses = []
  if (wins.length > 0) clauses.push(`wins in ${formatList(wins)}`)
  if (loses.length > 0) clauses.push(`loses in ${formatList(loses)}`)
  if (irrelevant.length > 0) clauses.push(`is irrelevant in ${formatList(irrelevant)}`)

  if (clauses.length > 0) {
    return `${row.title} ${formatClauseList(clauses)}.`
  }

  if (failures.length > 0) {
    return `${row.title} has runtime-specific failures: ${failures.slice(0, 2).join('; ')}.`
  }

  return `${row.title} needs at least two comparable snippets per environment before wins and losses are meaningful.`
}

function labelsForComparison(cells: CompatibilityCell[], comparison: CompatibilityCellComparison) {
  return cells
    .filter(cell => cell.comparison === comparison)
    .map(cell => environmentLabel(cell.environmentKey))
}

function browserBucket(browserName: unknown) {
  const name = String(browserName || '').toLowerCase()
  if (!name) return null
  if (name.includes('firefox') || name.includes('fxios')) return 'firefox'
  if ((name.includes('safari') || name.includes('mobile safari')) && !/(chrome|chromium|crios|android)/.test(name)) return 'safari'
  if (name.includes('chrome') || name.includes('chromium') || name.includes('crios')) return 'chrome'
  return null
}

function firstNonCompletedProfile(profiles: any[]) {
  return asArray(profiles).find(profile => profile?.state && profile.state !== 'completed')
}

function defaultEngineReason(environmentKey: string, state: CompatibilityCellState) {
  if (environmentKey === 'quickjs' && state === 'unsupported') {
    return 'QuickJS no-JIT baseline cannot run this snippet.'
  }
  if (environmentKey === 'quickjs') return 'QuickJS no-JIT baseline returned no successful profiles.'
  if (environmentKey === 'v8') return 'V8 isolated sandbox returned no successful profiles.'
  return 'No successful profiles.'
}

function runtimeBase(entry: any) {
  return String(entry?.runtimeName || entry?.runtime || '')
    .trim()
    .toLowerCase()
    .split('@')[0]
}

function runtimeLabel(entry: any) {
  const base = environmentLabel(runtimeBase(entry))
  const version = entry?.version || runtimeVersion(entry?.runtime)
  return version ? `${base} ${version}` : base
}

function runtimeVersion(runtimeId: unknown) {
  const value = String(runtimeId || '')
  const marker = value.indexOf('@')
  return marker === -1 ? null : value.slice(marker + 1)
}

function environmentLabel(key: string) {
  return COMPATIBILITY_ENVIRONMENTS.find(environment => environment.key === key)?.shortLabel || key
}

function positiveOps(value: unknown) {
  const n = Number(value)
  return isPositiveFiniteNumber(n) ? n : 0
}

function averagePositiveOps(profiles: any[]) {
  const values = asArray(profiles)
    .map(profile => Number(profile?.opsPerSec))
    .filter(isPositiveFiniteNumber)
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function asArray<T = any>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function formatList(items: string[]) {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function formatClauseList(clauses: string[]) {
  if (clauses.length <= 1) return clauses[0] || ''
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`
}
