import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CheckCircle2, Gauge, GitBranch, Info, Trophy } from 'lucide-react'
import {
  buildCompatibilityMatrix,
  type CompatibilityCell,
  type CompatibilityCellComparison,
  type CompatibilityCellState,
  type CompatibilityEnvironment,
  type CompatibilityEnvironmentGroup,
  type CompatibilityTestRow,
} from '@/lib/compatibilityMatrix'

type CompatibilityMatrixProps = {
  results: any[]
  browserStats?: Record<string, any[]> | null
  multiRuntime?: {
    status?: string | null
    error?: string | null
  } | null
}

export default function CompatibilityMatrix({
  results,
  browserStats = null,
  multiRuntime = null,
}: CompatibilityMatrixProps) {
  if (!Array.isArray(results) || results.length === 0) return null

  const matrix = buildCompatibilityMatrix({
    results,
    browserStats,
    multiRuntimeStatus: multiRuntime?.status,
    multiRuntimeError: multiRuntime?.error,
  })

  if (matrix.tests.length === 0) return null

  const leaderboard = rankTests(matrix.tests)
  const overview = buildOverviewStats(leaderboard, matrix.environments.length)

  return (
    <Card className="border-violet-200/70 dark:border-violet-800/50 shadow-sm overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="mt-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 p-2">
            <Gauge className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              Cross-Runtime Compatibility + Performance Matrix
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
              Ranked test cases across browsers, server runtimes, QuickJS no-JIT, and isolated V8.
            </p>
          </div>
        </div>

        <OverviewStats stats={overview} />

        <LeaderboardTable
          rows={leaderboard}
          environmentGroups={matrix.environmentGroups}
        />

        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
          Hover or focus cells for source, verdict, and runtime-specific failure details.
        </p>
      </CardContent>
    </Card>
  )
}

type OverviewStats = {
  topTitle: string
  topScore: number
  measuredCells: number
  totalCells: number
  coveragePct: number
  divergentTests: number
  failureCount: number
}

type LeaderboardRow = CompatibilityTestRow & {
  rank: number
  wins: number
  losses: number
  ties: number
  failures: number
  score: number
}

function OverviewStats({ stats }: { stats: OverviewStats }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <OverviewStat
        icon={Trophy}
        label="Leader"
        value={stats.topScore > 0 ? `+${stats.topScore}` : String(stats.topScore)}
        detail={stats.topTitle}
        tone="violet"
      />
      <OverviewStat
        icon={CheckCircle2}
        label="Coverage"
        value={`${stats.coveragePct}%`}
        detail={`${stats.measuredCells}/${stats.totalCells} cells measured`}
        tone="emerald"
      />
      <OverviewStat
        icon={GitBranch}
        label="Divergence"
        value={String(stats.divergentTests)}
        detail="tests with wins and losses"
        tone="sky"
      />
      <OverviewStat
        icon={AlertTriangle}
        label="Failures"
        value={stats.failureCount ? String(stats.failureCount) : 'none'}
        detail="unsupported or failed cells"
        tone={stats.failureCount ? 'amber' : 'slate'}
      />
    </div>
  )
}

function OverviewStat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: any
  label: string
  value: string
  detail: string
  tone: 'violet' | 'emerald' | 'sky' | 'amber' | 'slate'
}) {
  const palette = {
    violet: 'border-violet-200/70 bg-violet-50/50 text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/20 dark:text-violet-300',
    emerald: 'border-emerald-200/70 bg-emerald-50/50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300',
    sky: 'border-sky-200/70 bg-sky-50/50 text-sky-700 dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-sky-300',
    amber: 'border-amber-200/70 bg-amber-50/50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300',
    slate: 'border-border/60 bg-muted/20 text-muted-foreground',
  }[tone]

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${palette}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="truncate text-xl font-black tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium opacity-80">
        {detail}
      </div>
    </div>
  )
}

function LeaderboardTable({
  rows,
  environmentGroups,
}: {
  rows: LeaderboardRow[]
  environmentGroups: CompatibilityEnvironmentGroup[]
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/40">
              <th rowSpan={2} scope="col" className="w-12 px-3 py-2 text-left font-medium text-muted-foreground">
                Rank
              </th>
              <th rowSpan={2} scope="col" className="min-w-56 px-3 py-2 text-left font-medium text-muted-foreground">
                Test case
              </th>
              <th rowSpan={2} scope="col" className="w-20 px-3 py-2 text-right font-medium text-muted-foreground">
                <HeaderTooltip label="Score" text="+2 per win, +1 per tie, -2 per loss, -1 per failure." align="right" />
              </th>
              {environmentGroups.map(group => (
                <th
                  key={group.key}
                  scope="colgroup"
                  colSpan={group.environments.length}
                  className="border-l border-border/50 px-2 py-1.5 text-center font-semibold text-muted-foreground"
                >
                  <HeaderTooltip label={group.label} text={group.description} />
                </th>
              ))}
            </tr>
            <tr className="border-b border-border/60 bg-muted/20">
              {environmentGroups.flatMap(group =>
                group.environments.map((environment, index) => (
                  <th
                    key={environment.key}
                    scope="col"
                    className={`min-w-24 px-2 py-1.5 text-right font-medium text-muted-foreground ${index === 0 ? 'border-l border-border/50' : ''}`}
                  >
                    <HeaderTooltip label={environment.shortLabel} text={`${environment.label} (${environment.engine})`} align="right" />
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map(row => (
              <LeaderboardTableRow
                key={row.testIndex}
                row={row}
                environmentGroups={environmentGroups}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HeaderTooltip({
  label,
  text,
  align = 'center',
}: {
  label: string
  text: string
  align?: 'center' | 'right'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${align === 'right' ? 'text-right' : 'text-center'}`}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function LeaderboardTableRow({
  row,
  environmentGroups,
}: {
  row: LeaderboardRow
  environmentGroups: CompatibilityEnvironmentGroup[]
}) {
  return (
    <tr className="align-middle hover:bg-muted/20">
      <td className="px-3 py-2">
        <RankBadge rank={row.rank} />
      </td>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="flex max-w-md items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm">
              <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Test {row.testIndex + 1}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">
            {row.insight}
          </TooltipContent>
        </Tooltip>
      </th>
      <td className="px-3 py-2 text-right">
        <ScoreCell row={row} />
      </td>
      {environmentGroups.flatMap(group =>
        group.environments.map((environment, index) => {
          const cell = row.cells.find(entry => entry.environmentKey === environment.key)
          return (
            <td
              key={environment.key}
              className={`px-2 py-2 text-right ${index === 0 ? 'border-l border-border/50' : ''}`}
            >
              {cell ? <MatrixCell cell={cell} environment={environment} /> : null}
            </td>
          )
        })
      )}
    </tr>
  )
}

function MatrixCell({
  cell,
  environment,
}: {
  cell: CompatibilityCell
  environment: CompatibilityEnvironment
}) {
  const ok = cell.state === 'ok' && cell.opsPerSec != null
  const detail = cellDetail(cell)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex min-w-20 items-center justify-end gap-1.5 rounded-full border px-2 py-1 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${cellClass(cell)}`}
          aria-label={`${environment.label}: ${ok ? `${Math.round(cell.opsPerSec)} ops per second` : stateLabel(cell.state)}`}
        >
          <span className="font-semibold tabular-nums">
            {ok ? formatOps(cell.opsPerSec) : stateLabel(cell.state)}
          </span>
          <ComparisonDot comparison={cell.comparison} state={cell.state} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <div className="space-y-1">
          <div className="font-semibold text-popover-foreground">
            {environment.label} <span className="font-normal text-muted-foreground">({environment.engine})</span>
          </div>
          <div>{ok ? `${Math.round(cell.opsPerSec)} ops/s` : stateLabel(cell.state)}</div>
          <div>{comparisonText(cell)}</div>
          {detail && <div className="text-muted-foreground">{detail}</div>}
          {cell.reason && <div className="text-muted-foreground">{cell.reason}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-700 dark:text-violet-300">
      {rank}
    </span>
  )
}

function ScoreCell({ row }: { row: LeaderboardRow }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className={`text-sm font-bold tabular-nums ${row.score > 0 ? 'text-emerald-700 dark:text-emerald-300' : row.score < 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
            {row.score > 0 ? `+${row.score}` : row.score}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="">
        {row.wins} wins, {row.losses} losses, {row.ties} ties
        {row.failures > 0 ? `, ${row.failures} failures` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

function ComparisonDot({
  comparison,
  state,
}: {
  comparison: CompatibilityCellComparison
  state: CompatibilityCellState
}) {
  const cls = dotClass(comparison, state)
  if (!cls) return null

  return <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
}

function cellClass(cell: CompatibilityCell) {
  if (cell.state === 'pending') return 'border-violet-200/70 bg-violet-50/40 text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/20 dark:text-violet-300'
  if (cell.state === 'failed') return 'border-red-200/70 bg-red-50/40 text-red-700 dark:border-red-800/50 dark:bg-red-950/20 dark:text-red-300'
  if (cell.state === 'unsupported') return 'border-amber-200/70 bg-amber-50/40 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300'
  if (cell.state === 'no-data') return 'border-border/50 bg-muted/20 text-muted-foreground'

  if (cell.comparison === 'wins') return 'border-emerald-300/70 bg-emerald-50/50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (cell.comparison === 'loses') return 'border-red-300/70 bg-red-50/50 text-red-700 dark:border-red-800/50 dark:bg-red-950/20 dark:text-red-300'
  if (cell.comparison === 'irrelevant') return 'border-border/60 bg-muted/30 text-muted-foreground'
  return 'border-border/50 bg-background text-foreground'
}

function dotClass(comparison: CompatibilityCellComparison, state: CompatibilityCellState) {
  if (state === 'failed') return 'bg-red-500'
  if (state === 'unsupported') return 'bg-amber-500'
  if (state === 'pending') return 'bg-violet-500'
  if (state !== 'ok') return 'bg-muted-foreground/40'
  if (comparison === 'wins') return 'bg-emerald-500'
  if (comparison === 'loses') return 'bg-red-500'
  if (comparison === 'irrelevant') return 'bg-muted-foreground/50'
  if (comparison === 'single') return 'bg-violet-500'
  return null
}

function stateLabel(state: CompatibilityCellState) {
  if (state === 'pending') return 'Pending'
  if (state === 'failed') return 'Failed'
  if (state === 'unsupported') return 'Unsupported'
  return 'No data'
}

function formatOps(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function cellDetail(cell: CompatibilityCell) {
  if (cell.count) return `${cell.count} run${cell.count === 1 ? '' : 's'}`
  if (cell.label) return cell.label
  return null
}

function comparisonText(cell: CompatibilityCell) {
  if (cell.state === 'pending') return 'Pending on the runtime worker.'
  if (cell.state === 'failed') return 'Failed in this environment.'
  if (cell.state === 'unsupported') return 'Unsupported in this environment.'
  if (cell.state === 'no-data') return 'No comparable data yet.'
  if (cell.comparison === 'wins') return 'Winner for this environment.'
  if (cell.comparison === 'loses') return 'Slower than the alternatives in this environment.'
  if (cell.comparison === 'irrelevant') return 'Effect is within the tie threshold.'
  if (cell.comparison === 'single') return 'Measured, but no peer result to compare against yet.'
  return 'Measured result.'
}

function rankTests(tests: CompatibilityTestRow[]): LeaderboardRow[] {
  return tests
    .map(test => {
      const wins = test.cells.filter(cell => cell.comparison === 'wins').length
      const losses = test.cells.filter(cell => cell.comparison === 'loses').length
      const ties = test.cells.filter(cell => cell.comparison === 'irrelevant').length
      const failures = test.cells.filter(cell => cell.state === 'failed' || cell.state === 'unsupported').length
      return {
        ...test,
        wins,
        losses,
        ties,
        failures,
        score: (wins * 2) + ties - (losses * 2) - failures,
        rank: 0,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.wins !== a.wins) return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return a.testIndex - b.testIndex
    })
    .map((test, index) => ({ ...test, rank: index + 1 }))
}

function buildOverviewStats(rows: LeaderboardRow[], environmentCount: number): OverviewStats {
  const totalCells = rows.length * environmentCount
  const measuredCells = rows.reduce(
    (sum, row) => sum + row.cells.filter(cell => cell.state === 'ok').length,
    0,
  )
  const failureCount = rows.reduce((sum, row) => sum + row.failures, 0)
  const divergentTests = rows.filter(row => row.wins > 0 && row.losses > 0).length
  const top = rows[0]

  return {
    topTitle: top?.title || 'No tests',
    topScore: top?.score || 0,
    measuredCells,
    totalCells,
    coveragePct: totalCells > 0 ? Math.round((measuredCells / totalCells) * 100) : 0,
    divergentTests,
    failureCount,
  }
}
