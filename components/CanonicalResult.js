import { Card, CardContent } from '@/components/ui/card'
import { formatNumber } from '../utils/ArrayUtils'

function hasEngineError(result) {
  return (
    result.v8?.profiles?.some(p => p.state === 'errored') ||
    result.quickjs?.profiles?.some(p => p.state === 'errored')
  )
}

function getFirstError(result) {
  const v8Error = result.v8?.profiles?.find(p => p.state === 'errored')
  const qjsError = result.quickjs?.profiles?.find(p => p.state === 'errored')
  return v8Error?.error || qjsError?.error || 'Unknown error'
}

export default function CanonicalResult({ results, comparison }) {
  if (!results || results.length === 0) return null

  const v8AllErrored = results.every(r =>
    r.v8?.profiles?.every(p => p.state === 'errored') || r.v8?.opsPerSec === 0
  )

  const getOps = (r) => v8AllErrored ? r.quickjs.opsPerSec : r.v8.opsPerSec
  const engineLabel = v8AllErrored ? 'QuickJS (interpreter)' : null

  const allErrored = results.every(r =>
    hasEngineError(r) && r.v8.opsPerSec === 0 && r.quickjs.opsPerSec === 0
  )
  const sorted = [...results].sort((a, b) => getOps(b) - getOps(a))
  const fastest = sorted[0]
  const second = sorted.length > 1 ? sorted[1] : null

  const diffPercent = second && getOps(second) > 0
    ? Math.round(((getOps(fastest) - getOps(second)) / getOps(second)) * 100)
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

        {allErrored && (
          <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20">
            <p className="text-xs font-medium text-red-800 dark:text-red-200">
              All engines encountered errors. Try re-running the analysis.
            </p>
          </div>
        )}

        {v8AllErrored && !allErrored && (
          <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              V8 sandbox unavailable — showing QuickJS interpreter results. Ranking is based on
              algorithmic performance without JIT optimization.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {sorted.map((r, i) => {
            const ops = getOps(r)
            const errored = ops === 0 && hasEngineError(r)
            const isFastest = i === 0 && !allErrored
            const isSlowest = i === sorted.length - 1 && sorted.length > 1 && !allErrored

            return (
              <div
                key={r.testIndex}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  errored
                    ? 'border-red-200/60 bg-red-50/30 dark:border-red-800/60 dark:bg-red-950/10'
                    : isFastest
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20'
                      : 'border-border/40 bg-muted/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    errored
                      ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                      : isFastest
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                        : isSlowest
                          ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                          : 'bg-muted text-muted-foreground'
                  }`}>
                    {errored ? '!' : `#${i + 1}`}
                  </span>
                  <div>
                    <span className="text-sm font-medium text-foreground">{r.title}</span>
                    {errored && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 max-w-xs truncate">
                        {getFirstError(r)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {errored ? (
                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">Error</span>
                  ) : (
                    <>
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        {formatNumber(ops)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">ops/s</span>
                    </>
                  )}
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
            {engineLabel && <span className="text-muted-foreground/70"> ({engineLabel})</span>}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
