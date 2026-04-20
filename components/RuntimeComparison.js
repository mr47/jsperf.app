import { Card, CardContent } from '@/components/ui/card'
import { Cpu, Trophy } from 'lucide-react'

const RUNTIME_META = {
  node: { label: 'Node.js', engine: 'V8',  text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  deno: { label: 'Deno',    engine: 'V8',  text: 'text-sky-600 dark:text-sky-400',         dot: 'bg-sky-500' },
  bun:  { label: 'Bun',     engine: 'JSC', text: 'text-pink-600 dark:text-pink-400',       dot: 'bg-pink-500' },
}

const RUNTIME_ORDER = ['node', 'deno', 'bun']

function formatOps(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function formatLatency(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`
  return `${ms.toFixed(2)}ms`
}

function formatBytes(n) {
  if (n == null) return '—'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function formatBig(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export default function RuntimeComparison({ results }) {
  if (!results || results.length === 0) return null

  const anyData = results.some(r => r.runtimeComparison?.available)
  const anyError = results.some(r => r.multiRuntimeError)

  if (!anyData && !anyError) return null

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="h-4 w-4 text-violet-500" />
          <h3 className="text-base font-semibold text-foreground">
            Runtime Comparison
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Same snippet executed in Node.js, Deno, and Bun under a matched
          CPU + memory budget. V8 (Node, Deno) vs JavaScriptCore (Bun)
          surfaces engine-level performance differences that single-engine
          analysis cannot.
        </p>

        {anyError && !anyData && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 mb-4">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Multi-runtime worker is configured but unreachable. Showing core analysis only.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {results.map((r) => {
            const cmp = r.runtimeComparison
            if (!cmp || !cmp.available) return null
            return <TestRuntimePanel key={r.testIndex} title={r.title} comparison={cmp} />
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function TestRuntimePanel({ title, comparison }) {
  const byName = Object.fromEntries(comparison.runtimes.map(r => [r.runtime, r]))
  const ordered = RUNTIME_ORDER.map(name => byName[name]).filter(Boolean)

  // Flatten everything we want to display to a single per-runtime record so
  // we can drive the table from a uniform `series` shape regardless of
  // whether the row comes from the benchmark itself or perf-stat counters.
  const series = ordered.map((rt) => {
    const p = rt.profiles?.[0] || {}
    const c = p.perfCounters || {}
    const ipc = (c.instructions != null && c.cycles != null && c.cycles > 0)
      ? c.instructions / c.cycles
      : null
    return {
      runtime: rt.runtime,
      meta: RUNTIME_META[rt.runtime],
      hasError: rt.hasError,
      error: rt.error,
      values: {
        opsPerSec:    rt.avgOpsPerSec || 0,
        latencyMean:  p.latencyMean ?? null,
        latencyP99:   p.latencyP99  ?? null,
        rss:          p.rss         ?? null,
        heapUsed:     p.heapUsed    ?? null,
        instructions: c.instructions ?? null,
        cycles:       c.cycles       ?? null,
        ipc,
        cacheMisses:  c['cache-misses']  ?? null,
        branchMisses: c['branch-misses'] ?? null,
      },
    }
  })

  const hasPerf = series.some(s =>
    s.values.instructions != null
    || s.values.cycles != null
    || s.values.cacheMisses != null
    || s.values.branchMisses != null
  )

  // Section grouping = Throughput / Latency / Memory / Hardware counters.
  // `direction` controls which value gets the trophy: 'higher' for ops/s and
  // IPC; 'lower' for latency, memory, cache misses, etc. `null` skips the
  // winner highlight (e.g. raw instruction count is not "better/worse" alone).
  const sections = [
    {
      label: 'Throughput',
      rows: [
        { key: 'opsPerSec', label: 'Ops / second', direction: 'higher', format: formatOps },
      ],
    },
    {
      label: 'Latency',
      rows: [
        { key: 'latencyMean', label: 'Mean (p50)', direction: 'lower', format: formatLatency },
        { key: 'latencyP99',  label: 'p99',        direction: 'lower', format: formatLatency },
      ],
    },
    {
      label: 'Memory',
      rows: [
        { key: 'rss',      label: 'RSS',           direction: 'lower', format: formatBytes },
        { key: 'heapUsed', label: 'Heap used',     direction: 'lower', format: formatBytes },
      ],
    },
  ]

  if (hasPerf) {
    sections.push({
      label: 'Hardware counters',
      rows: [
        { key: 'instructions', label: 'Instructions',      direction: null,     format: formatBig },
        { key: 'cycles',       label: 'Cycles',            direction: null,     format: formatBig },
        { key: 'ipc',          label: 'IPC (instr/cycle)', direction: 'higher', format: (v) => v.toFixed(2) },
        { key: 'cacheMisses',  label: 'Cache misses',      direction: 'lower',  format: formatBig },
        { key: 'branchMisses', label: 'Branch misses',     direction: 'lower',  format: formatBig },
      ],
      footer: 'IPC > ~2 typically means well-vectorized JIT output; < ~1 suggests cache or branch-misprediction stalls. Counters render “—” when the host kernel disallows perf events.',
    })
  }

  return (
    <div className="space-y-3">
      {title && (
        <div className="text-sm font-medium text-foreground">{title}</div>
      )}

      {comparison.spread > 1 && (
        <div className="text-xs text-muted-foreground">
          Throughput spread: <span className="font-medium text-foreground">{comparison.spread}x</span>
          {' between '}
          <span className={RUNTIME_META[comparison.fastestRuntime]?.text}>
            {RUNTIME_META[comparison.fastestRuntime]?.label || comparison.fastestRuntime}
          </span>
          {' and '}
          <span className={RUNTIME_META[comparison.slowestRuntime]?.text}>
            {RUNTIME_META[comparison.slowestRuntime]?.label || comparison.slowestRuntime}
          </span>
        </div>
      )}

      <UnifiedTable series={series} sections={sections} />

      {series.some(s => s.hasError) && (
        <div className="text-[11px] text-red-600 dark:text-red-400 space-y-0.5">
          {series.filter(s => s.hasError).map(s => (
            <div key={s.runtime}>
              <span className={`font-medium ${s.meta.text}`}>{s.meta.label}:</span>{' '}
              {s.error || 'errored on every profile.'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One table to rule them all: runtimes are columns, metrics are rows,
 * grouped into sections (Throughput / Latency / Memory / HW counters).
 *
 * Per-row "winner" detection: for direction='higher' we bold + trophy the
 * largest value; for 'lower' the smallest non-zero value; for null (raw
 * counts) nothing is highlighted because the row carries no inherent
 * winner semantics on its own.
 */
function UnifiedTable({ series, sections }) {
  return (
    <div className="rounded-lg border border-border/50 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-muted/40">
            <th className="text-left font-normal text-muted-foreground py-2 px-3 w-[40%]">
              Metric
            </th>
            {series.map((s) => (
              <th key={s.runtime} className="text-right font-normal py-2 px-3">
                <div className="inline-flex items-center gap-1.5 justify-end">
                  <span className={`inline-block h-2 w-2 rounded-full ${s.meta.dot}`} />
                  <span className={`font-semibold ${s.meta.text}`}>{s.meta.label}</span>
                  <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground">
                    {s.meta.engine}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sIdx) => (
            <SectionRows
              key={section.label}
              section={section}
              series={series}
              isFirstSection={sIdx === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SectionRows({ section, series, isFirstSection }) {
  return (
    <>
      <tr className={`bg-muted/20 ${isFirstSection ? '' : 'border-t-2 border-border/60'}`}>
        <td colSpan={1 + series.length} className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium py-1.5 px-3">
          {section.label}
        </td>
      </tr>

      {section.rows.map((row) => {
        const values = series.map(s => s.values[row.key])
        const winnerIdx = pickWinnerIndex(values, row.direction)

        return (
          <tr key={row.key} className="border-t border-border/30">
            <td className="py-1.5 px-3 text-foreground">{row.label}</td>
            {series.map((s, i) => {
              const v = s.values[row.key]
              const valid = v != null && Number.isFinite(v)
              const isWinner = i === winnerIdx
              return (
                <td
                  key={s.runtime}
                  className={`py-1.5 px-3 text-right tabular-nums ${
                    isWinner ? 'font-semibold text-foreground' : (valid ? 'text-foreground' : 'text-muted-foreground/60')
                  }`}
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    {isWinner && <Trophy className="h-3 w-3 text-amber-500" aria-label="Best" />}
                    <span>{valid ? row.format(v) : '—'}</span>
                  </span>
                </td>
              )
            })}
          </tr>
        )
      })}

      {section.footer && (
        <tr>
          <td colSpan={1 + series.length} className="py-1 px-3 text-[10px] text-muted-foreground/80 italic">
            {section.footer}
          </td>
        </tr>
      )}
    </>
  )
}

function pickWinnerIndex(values, direction) {
  if (!direction) return -1
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v != null && Number.isFinite(v) && v > 0)
  if (valid.length < 2) return -1
  const best = direction === 'higher'
    ? valid.reduce((a, b) => (b.v > a.v ? b : a))
    : valid.reduce((a, b) => (b.v < a.v ? b : a))
  return best.i
}
