import { Card, CardContent } from '@/components/ui/card'
import { formatNumber } from '../utils/ArrayUtils'

export default function CanonicalResult({ results, comparison }) {
  if (!results || results.length === 0) return null

  const sorted = [...results].sort((a, b) => b.v8.opsPerSec - a.v8.opsPerSec)
  const fastest = sorted[0]
  const second = sorted.length > 1 ? sorted[1] : null

  const diffPercent = second && second.v8.opsPerSec > 0
    ? Math.round(((fastest.v8.opsPerSec - second.v8.opsPerSec) / second.v8.opsPerSec) * 100)
    : null

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">
          Controlled Environment Results
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Reproducible results from an isolated server environment. Running this analysis again will yield the same ranking.
        </p>

        <div className="space-y-2">
          {sorted.map((r, i) => {
            const isFastest = i === 0
            const isSlowest = i === sorted.length - 1 && sorted.length > 1

            return (
              <div
                key={r.testIndex}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  isFastest
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20'
                    : 'border-border/40 bg-muted/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    isFastest
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                      : isSlowest
                        ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    #{i + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground">{r.title}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatNumber(r.v8.opsPerSec)}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">ops/s</span>
                </div>
              </div>
            )
          })}
        </div>

        {diffPercent != null && diffPercent > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            <span className="font-medium text-foreground">{fastest.title}</span>
            {' '}is {diffPercent}% faster than{' '}
            <span className="font-medium text-foreground">{second.title}</span>
            {diffPercent < 5 ? ' (marginal difference)' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
