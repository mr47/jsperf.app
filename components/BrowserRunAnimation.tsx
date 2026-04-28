import type { CSSProperties } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Activity, Trophy } from 'lucide-react'
import { formatNumber } from '../utils/ArrayUtils'

const FASTEST_LAP_SECONDS = 1.6
const SLOWEST_LAP_SECONDS = 12

const LANE_STYLES = [
  {
    dot: 'bg-emerald-500',
              marker: 'bg-emerald-500 shadow-emerald-500/25',
    rail: 'from-emerald-500/25 via-emerald-500/10 to-transparent',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    dot: 'bg-sky-500',
              marker: 'bg-sky-500 shadow-sky-500/25',
    rail: 'from-sky-500/25 via-sky-500/10 to-transparent',
    text: 'text-sky-600 dark:text-sky-400',
  },
  {
    dot: 'bg-amber-500',
              marker: 'bg-amber-500 shadow-amber-500/25',
    rail: 'from-amber-500/25 via-amber-500/10 to-transparent',
    text: 'text-amber-600 dark:text-amber-400',
  },
  {
    dot: 'bg-violet-500',
              marker: 'bg-violet-500 shadow-violet-500/25',
    rail: 'from-violet-500/25 via-violet-500/10 to-transparent',
    text: 'text-violet-600 dark:text-violet-400',
  },
  {
    dot: 'bg-rose-500',
              marker: 'bg-rose-500 shadow-rose-500/25',
    rail: 'from-rose-500/25 via-rose-500/10 to-transparent',
    text: 'text-rose-600 dark:text-rose-400',
  },
]

export default function BrowserRunAnimation({ tests, benchStatus }) {
  if (benchStatus !== 'complete') return null

  const entries = (Array.isArray(tests) ? tests : [])
    .map((test, index) => {
      const opsPerSec = Number(test?.opsPerSec)
      if (!Number.isFinite(opsPerSec) || opsPerSec <= 0) return null
      if (test?.status !== 'finished') return null
      return {
        index,
        title: test?.title || `Test ${index + 1}`,
        opsPerSec,
        status: test?.status,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.opsPerSec - a.opsPerSec)

  if (entries.length < 2) return null

  const fastest = entries[0].opsPerSec

  return (
    <Card className="mt-6 border-border/60 shadow-sm overflow-hidden">
      <CardContent className="p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              <h3 className="text-base font-semibold text-foreground">
                Browser Run Speed Animation
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
              Each lane is one benchmark case from this browser run. The ball
              moves faster when that case has higher ops/sec.
            </p>
          </div>
          <div className="w-fit rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Final browser run
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {entries.map((entry, sortedIndex) => {
            const style = LANE_STYLES[entry.index % LANE_STYLES.length]
            const speedRatio = fastest > 0 ? entry.opsPerSec / fastest : 0
            const slowerRatio = speedRatio > 0 ? fastest / entry.opsPerSec : 1
            const lapSeconds = Math.min(
              SLOWEST_LAP_SECONDS,
              Math.max(FASTEST_LAP_SECONDS, FASTEST_LAP_SECONDS * slowerRatio)
            )
            const staticPosition = `${Math.max(8, Math.min(94, speedRatio * 100))}%`
            const widthPct = `${Math.max(5, Math.min(100, speedRatio * 100))}%`
            const isFastest = sortedIndex === 0

            return (
              <div key={`${entry.index}-${entry.title}`} className="space-y-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                    <span className="truncate text-sm font-medium text-foreground">
                      {entry.title}
                    </span>
                    {isFastest && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        <Trophy className="h-3 w-3" />
                        fastest
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className={`font-semibold ${style.text}`}>
                      {formatNumber(Math.round(entry.opsPerSec))} ops/s
                    </span>
                    {!isFastest && (
                      <span className="text-muted-foreground">
                        {slowerRatio.toFixed(2)}x slower
                      </span>
                    )}
                  </div>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="relative h-10 overflow-hidden rounded-full border border-border/60 bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      tabIndex={0}
                      aria-label={`${entry.title}: ${formatNumber(Math.round(entry.opsPerSec))} operations per second`}
                    >
                      <div
                        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${style.rail}`}
                        style={{ width: widthPct }}
                      />
                      <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-border/80" />
                      <div
                        className={`browser-run-marker absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full shadow-lg ring-2 ring-white/70 dark:ring-black/30 ${style.marker}`}
                        style={{
                          '--lap-duration': `${lapSeconds}s`,
                          '--lap-delay': `${sortedIndex * -0.28}s`,
                          '--static-position': staticPosition,
                        } as CSSProperties}
                      >
                        <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-white/70" />
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isFastest
                      ? 'Fastest case in this browser run.'
                      : `${entry.title} is ${slowerRatio.toFixed(2)}x slower than the fastest case.`}
                  </TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
      </CardContent>

      <style jsx>{`
        .browser-run-marker {
          animation: browser-run-lap var(--lap-duration) ease-in-out infinite alternate;
          animation-delay: var(--lap-delay);
          left: 0.75rem;
        }

        @keyframes browser-run-lap {
          from {
            left: 0.75rem;
          }
          to {
            left: calc(100% - 2.5rem);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .browser-run-marker {
            animation: none;
            left: clamp(0.75rem, calc(var(--static-position) - 1.75rem), calc(100% - 2.5rem));
          }
        }
      `}</style>
    </Card>
  )
}
