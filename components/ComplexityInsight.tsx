// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card'
import MathNotation from '@/components/MathNotation'
import { Boxes, GitBranch, Gauge, Zap } from 'lucide-react'

const TIME_STEPS = [
  { key: 'constant', notation: 'O(1)', short: '1' },
  { key: 'logarithmic', notation: 'O(log n)', short: 'log' },
  { key: 'linear', notation: 'O(n)', short: 'n' },
  { key: 'linearithmic', notation: 'O(n log n)', short: 'n log n' },
  { key: 'quadratic', notation: 'O(n^2)', short: 'n^2' },
  { key: 'cubic', notation: 'O(n^3)', short: 'n^3' },
  { key: 'unknown', notation: 'unknown', short: '?' },
]

const SPACE_STEPS = [
  { key: 'constant', notation: 'O(1)' },
  { key: 'linear', notation: 'O(n)' },
  { key: 'quadratic', notation: 'O(n^2)' },
  { key: 'unknown', notation: 'unknown' },
]

const TIME_COLORS = {
  constant: {
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    border: 'border-emerald-200 dark:border-emerald-800/60',
    fill: 'bg-emerald-500',
  },
  logarithmic: {
    text: 'text-teal-700 dark:text-teal-300',
    bg: 'bg-teal-100 dark:bg-teal-900/30',
    border: 'border-teal-200 dark:border-teal-800/60',
    fill: 'bg-teal-500',
  },
  linear: {
    text: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-100 dark:bg-sky-900/30',
    border: 'border-sky-200 dark:border-sky-800/60',
    fill: 'bg-sky-500',
  },
  linearithmic: {
    text: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-100 dark:bg-violet-900/30',
    border: 'border-violet-200 dark:border-violet-800/60',
    fill: 'bg-violet-500',
  },
  quadratic: {
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    border: 'border-amber-200 dark:border-amber-800/60',
    fill: 'bg-amber-500',
  },
  cubic: {
    text: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-100 dark:bg-rose-900/30',
    border: 'border-rose-200 dark:border-rose-800/60',
    fill: 'bg-rose-500',
  },
  unknown: {
    text: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800',
    border: 'border-slate-200 dark:border-slate-700',
    fill: 'bg-slate-500',
  },
}

function formatConfidence(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'estimate'
  return `${Math.round(n * 100)}% confidence`
}

function confidencePercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 55
  return Math.max(12, Math.min(100, Math.round(n * 100)))
}

function asyncLabel(asyncInfo) {
  if (!asyncInfo || asyncInfo.mode === 'none') return null
  const labels = {
    'single-await': 'single await',
    'sequential-await': 'sequential awaits',
    'async-iteration': 'async iteration',
    'parallel-fanout': 'Promise fan-out',
    race: 'Promise race',
    unknown: 'async behavior',
  }
  return labels[asyncInfo.mode] || asyncInfo.mode
}

function stepIndex(steps, value) {
  const key = value?.key || labelToKey(value?.label) || notationToKey(value?.notation)
  const idx = steps.findIndex(step => step.key === key)
  return idx >= 0 ? idx : steps.length - 1
}

function labelToKey(label) {
  if (!label) return null
  return String(label).toLowerCase()
}

function notationToKey(notation) {
  if (!notation) return null
  const normalized = String(notation).toLowerCase().replace(/\s+/g, '')
  if (normalized === 'o(1)') return 'constant'
  if (normalized === 'o(logn)') return 'logarithmic'
  if (normalized === 'o(n)') return 'linear'
  if (normalized === 'o(nlogn)') return 'linearithmic'
  if (normalized === 'o(n^2)') return 'quadratic'
  if (normalized === 'o(n^3)') return 'cubic'
  return 'unknown'
}

function timeKey(complexity) {
  return TIME_STEPS[stepIndex(TIME_STEPS, complexity?.time)]?.key || 'unknown'
}

function spaceKey(complexity) {
  return SPACE_STEPS[stepIndex(SPACE_STEPS, complexity?.space)]?.key || 'unknown'
}

function isConstantSpace(complexity) {
  return spaceKey(complexity) === 'constant'
}

function ComplexityLadder({ complexity }) {
  const active = stepIndex(TIME_STEPS, complexity?.time)
  const key = timeKey(complexity)
  const palette = TIME_COLORS[key] || TIME_COLORS.unknown

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-2">
        {TIME_STEPS.slice(0, 6).map((step, index) => {
          const current = active === index
          return (
            <div key={step.key} className="min-w-0">
              <div className={`h-3 rounded-full transition-all ${current ? palette.fill : 'bg-muted'}`} />
              <div className={`mt-1.5 truncate text-center text-[10px] font-semibold ${current ? palette.text : 'text-muted-foreground/50'}`}>
                {step.short}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryStat({ icon: Icon, label, value, detail }) {
  return (
    <div className="min-h-[132px] rounded-3xl border border-border/60 bg-muted/20 p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-5 w-5" />}
        <span>{label}</span>
      </div>
      <div className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">{value}</div>
      {detail && (
        <div className="mt-3 text-sm font-medium leading-snug text-muted-foreground">{detail}</div>
      )}
    </div>
  )
}

export default function ComplexityInsight({ results }) {
  const rows = (results || []).filter(r => r?.complexity)
  if (rows.length === 0) return null

  const sortedByTime = [...rows].sort((a, b) =>
    stepIndex(TIME_STEPS, b.complexity?.time) - stepIndex(TIME_STEPS, a.complexity?.time)
  )
  const highest = sortedByTime[0]?.complexity
  const linearOrBetter = rows.filter(r => stepIndex(TIME_STEPS, r.complexity?.time) <= stepIndex(TIME_STEPS, { key: 'linear' })).length
  const constantSpaceCount = rows.filter(r => isConstantSpace(r.complexity)).length
  const asyncCount = rows.filter(r => r.complexity?.async?.mode && r.complexity.async.mode !== 'none').length
  const peakTitle = sortedByTime[0]?.title || 'slowest growth'

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-7 space-y-6">
          <div className="flex items-start gap-3">
            <div className="rounded-3xl bg-violet-100 p-4 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              <GitBranch className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">Static Complexity</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">static estimate</span>
              </div>
              <p className="mt-3 max-w-4xl text-base leading-relaxed text-muted-foreground">
                A structural read of loops, collection helpers, copies, and async scheduling.
                Setup is used as context, but only test bodies are scored.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryStat icon={Gauge} label="Peak" value={<MathNotation value={highest?.time?.notation} />} detail={peakTitle} />
            <SummaryStat icon={Boxes} label="Space" value={`${constantSpaceCount}/${rows.length}`} detail={<>estimated as <MathNotation value="O(1)" /></>} />
            <SummaryStat icon={Zap} label="Async" value={asyncCount ? `${asyncCount}` : 'none'} detail={asyncCount ? 'tests flagged' : 'no scheduling flags'} />
            <SummaryStat icon={GitBranch} label="Shape" value={`${linearOrBetter}/${rows.length}`} detail="linear or better" />
          </div>
        </div>

        <div className="space-y-6">
          {rows.map((r) => {
            const c = r.complexity
            const async = asyncLabel(c.async)
            const key = timeKey(c)
            const palette = TIME_COLORS[key] || TIME_COLORS.unknown
            const confidence = confidencePercent(c.time?.confidence)
            const setupSymbols = c.setupContext?.symbols || []
            return (
              <div key={r.testIndex ?? r.title} className={`rounded-3xl border ${palette.border} bg-card p-6 sm:p-7`}>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-foreground">{r.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{formatConfidence(c.time?.confidence)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-2xl px-5 py-2.5 text-base font-black tabular-nums ${palette.bg} ${palette.text}`}>
                      Time <MathNotation value={c.time?.notation} />
                    </span>
                    <span className="rounded-2xl bg-sky-100 px-5 py-2.5 text-base font-black tabular-nums text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                      Space <MathNotation value={c.space?.notation} />
                    </span>
                    {async && (
                      <span className="rounded-2xl bg-amber-100 px-5 py-2.5 text-base font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                        {async}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Time growth</div>
                      <div className={`text-xs font-bold ${palette.text}`}>{c.time?.label || timeKey(c)}</div>
                    </div>

                    <ComplexityLadder complexity={c} />

                    {c.explanation && (
                      <p className="mt-5 rounded-2xl bg-muted/25 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                        {c.explanation}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl bg-muted/25 p-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Space</div>
                        <div className="mt-1 text-base font-black text-foreground">{c.space?.label || spaceKey(c)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</div>
                        <div className="mt-2 h-2 rounded-full bg-background">
                          <div className={`h-full rounded-full ${palette.fill}`} style={{ width: `${confidence}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {(c.signals || []).slice(0, 4).map(signal => (
                        <span key={signal} className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {signal}
                        </span>
                      ))}
                    </div>

                    {setupSymbols.length > 0 && (
                      <div className="mt-5 text-xs leading-relaxed text-muted-foreground">
                        Context: <span className="font-medium text-foreground">{setupSymbols.slice(0, 4).join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Structural estimate only. Runtime panels below show what V8, QuickJS, and worker runtimes actually measured.
        </div>
      </CardContent>
    </Card>
  )
}
