import { Card, CardContent } from '@/components/ui/card'
import { Cpu } from 'lucide-react'
import PerfCounters from './PerfCounters'

const RUNTIME_META = {
  node: { label: 'Node.js', engine: 'V8', color: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  deno: { label: 'Deno', engine: 'V8', color: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500' },
  bun: { label: 'Bun', engine: 'JSC', color: 'text-pink-600 dark:text-pink-400', bar: 'bg-pink-500' },
}

const SCALING_LABELS = {
  linear: { label: 'Linear scaling', color: 'text-emerald-600 dark:text-emerald-400' },
  sublinear: { label: 'Sublinear scaling', color: 'text-amber-600 dark:text-amber-400' },
  plateau: { label: 'Plateau', color: 'text-slate-600 dark:text-slate-400' },
  degrading: { label: 'Degrading', color: 'text-red-600 dark:text-red-400' },
  noisy: { label: 'Noisy data', color: 'text-slate-500' },
  'insufficient-data': { label: 'Insufficient data', color: 'text-slate-500' },
}

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
          Same snippet executed in Node.js, Deno, and Bun under matched
          1x/2x/4x/8x CPU + memory budgets. V8 (Node, Deno) vs JavaScriptCore (Bun)
          surfaces engine-level performance differences that single-engine analysis cannot.
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
  const maxOps = Math.max(...comparison.runtimes.map(r => r.avgOpsPerSec), 1)

  return (
    <div className="space-y-3">
      {title && (
        <div className="text-sm font-medium text-foreground">{title}</div>
      )}

      {comparison.spread > 1 && (
        <div className="text-xs text-muted-foreground">
          Spread: <span className="font-medium text-foreground">{comparison.spread}x</span>
          {' between '}
          <span className={RUNTIME_META[comparison.fastestRuntime]?.color}>{RUNTIME_META[comparison.fastestRuntime]?.label || comparison.fastestRuntime}</span>
          {' and '}
          <span className={RUNTIME_META[comparison.slowestRuntime]?.color}>{RUNTIME_META[comparison.slowestRuntime]?.label || comparison.slowestRuntime}</span>
        </div>
      )}

      <div className="space-y-3">
        {comparison.runtimes.map((rt) => {
          const meta = RUNTIME_META[rt.runtime] || { label: rt.runtime, engine: '', color: '', bar: 'bg-violet-500' }
          const barWidth = maxOps > 0 ? Math.max(2, (rt.avgOpsPerSec / maxOps) * 100) : 0
          const scaling = SCALING_LABELS[rt.scalingType] || SCALING_LABELS['insufficient-data']

          return (
            <div key={rt.runtime} className="rounded-lg border border-border/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {meta.engine}
                  </span>
                </div>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {formatOps(rt.avgOpsPerSec)} ops/s
                </span>
              </div>

              <div className="w-full bg-muted rounded-full h-1.5 mb-3 overflow-hidden">
                <div className={`${meta.bar} h-1.5 rounded-full transition-all duration-700`} style={{ width: `${barWidth}%` }} />
              </div>

              {rt.hasError ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {rt.error || 'Runtime errored on every profile.'}
                </p>
              ) : (
                <>
                  <ProfileTable profiles={rt.profiles} />
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className={`${scaling.color} font-medium`}>{scaling.label}</span>
                    {rt.scalingConfidence > 0 && (
                      <span className="text-muted-foreground tabular-nums">
                        R²={rt.scalingConfidence.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <PerfCounters profiles={rt.profiles} />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProfileTable({ profiles }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-normal py-1 px-1">Profile</th>
            <th className="font-normal py-1 px-1 text-right">ops/s</th>
            <th className="font-normal py-1 px-1 text-right">p50</th>
            <th className="font-normal py-1 px-1 text-right">p99</th>
            <th className="font-normal py-1 px-1 text-right">RSS</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.label} className="border-t border-border/30">
              <td className="py-1 px-1 text-foreground">
                <span className="font-medium">{p.label}</span>
                <span className="text-muted-foreground ml-1">
                  ({p.cpus}cpu/{p.memMb}M)
                </span>
              </td>
              <td className="py-1 px-1 text-right tabular-nums text-foreground">
                {p.state === 'errored' ? '—' : formatOps(p.opsPerSec)}
              </td>
              <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">
                {formatLatency(p.latencyMean)}
              </td>
              <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">
                {formatLatency(p.latencyP99)}
              </td>
              <td className="py-1 px-1 text-right tabular-nums text-muted-foreground">
                {formatBytes(p.rss)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
