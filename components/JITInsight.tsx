// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card'

const CHARACTERISTIC_LABELS = {
  cpuBound: { label: 'CPU-bound', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  memoryBound: { label: 'Memory-bound', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  allocationHeavy: { label: 'Allocation-heavy', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  jitFriendly: { label: 'JIT-friendly', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  v8Unavailable: { label: 'V8 unavailable', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

export default function JITInsight({ results, comparison }) {
  if (!results || results.length === 0) return null

  const v8Unavailable = results.every(r => r.prediction?.characteristics?.v8Unavailable)
  const validResults = results.filter(r => r.prediction.jitBenefit > 0)

  if (validResults.length === 0 && !v8Unavailable) return null

  const maxJitBenefit = Math.max(...results.map(r => r.prediction.jitBenefit), 1)
  const hasDivergence = comparison?.divergence && validResults.length > 1

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">
          Why Is It Faster?
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          JIT amplification shows how much V8's optimizer helps each snippet.
          Higher means the code benefits more from JIT compilation.
        </p>

        {v8Unavailable && (
          <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
            <p className="text-xs text-muted-foreground">
              JIT amplification data is unavailable — the V8 sandbox could not be reached.
              Results below are based on QuickJS interpreter performance only.
            </p>
          </div>
        )}

        {hasDivergence && (
          <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              Interesting: the algorithmically fastest snippet (interpreter) differs from
              the runtime fastest (V8 JIT). The performance difference is driven by JIT
              optimization, not algorithm.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {results.map((r) => {
            const barWidth = maxJitBenefit > 0
              ? Math.max(5, (r.prediction.jitBenefit / maxJitBenefit) * 100)
              : 50
            const chars = r.prediction.characteristics || {}

            return (
              <div key={r.testIndex}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground">{r.title}</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {r.prediction.jitBenefit}x
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div
                    className="bg-violet-500 h-2.5 rounded-full transition-all duration-700"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(chars).map(([key, value]) => {
                    if (!value || !CHARACTERISTIC_LABELS[key]) return null
                    const { label, color } = CHARACTERISTIC_LABELS[key]
                    return (
                      <span key={key} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${color}`}>
                        {label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-border/40">
          <p className="text-xs text-muted-foreground">
            {maxJitBenefit > 10
              ? 'High JIT amplification — performance depends heavily on V8\'s optimizer. Results may vary across JS engines.'
              : maxJitBenefit > 3
                ? 'Moderate JIT amplification — V8 provides meaningful optimization, but algorithmic differences also matter.'
                : 'Low JIT amplification — performance is primarily algorithmic. Results will be similar across JS engines.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
