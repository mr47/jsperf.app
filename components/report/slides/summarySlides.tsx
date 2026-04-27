// @ts-nocheck
import React, { useMemo } from 'react'
import { Activity, Crown, Gauge, Rocket, Sparkles, Trophy, Zap } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'

import SafeResponsiveContainer from '../../SafeResponsiveContainer'
import {
  formatDate,
  formatMultiplier,
  formatOps,
  rankEntries,
  speedColor,
} from '../slideUtils'
import { CodeBlock, SlideHeader, SlideShell, Tag } from './primitives'

/* ------------------------------------------------------------------ */
/*  Slide: Title                                                       */
/* ------------------------------------------------------------------ */

export function TitleSlide({ report }) {
  const { title, benchmark, summary, createdAt, creator } = report
  const headlineMultiplier = summary?.speedup
    ? formatMultiplier(summary.speedup)
    : null

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(139,92,246,0.45), transparent)"
      className="bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 text-white"
    >
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium uppercase tracking-[0.25em] text-violet-300/90">
          <Sparkles className="h-4 w-4" />
          <span>Performance Report</span>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-4xl">
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
            {title}
          </h1>
          {benchmark?.authorName && (
            <p className="mt-4 text-lg sm:text-xl text-violet-200/80">
              Benchmark by <span className="font-medium text-white">{benchmark.authorName}</span>
            </p>
          )}
          {headlineMultiplier && summary?.leader && summary?.lagger && (
            <div className="mt-10 inline-flex items-baseline gap-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-5 py-4 self-start">
              <span className="text-4xl sm:text-5xl font-bold text-emerald-300">{headlineMultiplier}</span>
              <span className="text-sm sm:text-base text-violet-100/90">
                <span className="font-semibold text-white">{summary.leader.title}</span>
                {' is faster than '}
                <span className="font-semibold text-white">{summary.lagger.title}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 text-sm text-violet-200/70">
          <div>
            <p className="text-xs uppercase tracking-wider text-violet-300/70">Generated</p>
            <p>{formatDate(createdAt)} · {creator?.name && `by ${creator.name}`}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-violet-300/70">Source</p>
            <p>jsperf.net/{report.slug}{report.revision > 1 ? `/${report.revision}` : ''}</p>
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Leaderboard                                                 */
/* ------------------------------------------------------------------ */

export function LeaderboardSlide({ report }) {
  const ranked = useMemo(() => rankEntries(report?.summary?.entries || []), [report])
  const max = ranked[0]?.opsPerSec || 1

  const data = ranked.map((e, i) => ({
    name: e.title,
    ops: e.opsPerSec,
    rel: (e.opsPerSec / max) * 100,
    color: speedColor(i, ranked.length),
  }))

  return (
    <SlideShell accent="radial-gradient(closest-side, rgba(16,185,129,0.25), transparent)">
      <SlideHeader icon={Gauge} eyebrow="Speed leaderboard" title="Ops per second, ranked" />
      <SafeResponsiveContainer className="flex-1 min-h-0">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 64, bottom: 8, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} className="opacity-30" />
          <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={formatOps} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 13 }}
            width={Math.min(220, Math.max(120, ...data.map(d => d.name.length * 7)))}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.1)' }}
            formatter={(value) => [formatOps(value) + ' ops/sec', 'Speed']}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Bar dataKey="ops" radius={[0, 8, 8, 0]} label={{
            position: 'right',
            formatter: (v) => formatOps(v),
            fontSize: 12,
            fill: 'currentColor',
          }}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </SafeResponsiveContainer>
      <p className="mt-4 text-xs text-muted-foreground">
        Source: {report?.summary?.dataSource === 'v8'
          ? 'V8 Firecracker analysis'
          : 'aggregated browser runs'}
        {' · ' + ranked.length + ' tests'}
      </p>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Speed animation                                             */
/* ------------------------------------------------------------------ */

const SPEED_BALL_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4']
const FASTEST_BALL_LAP_SECONDS = 1.4
const SLOWEST_BALL_LAP_SECONDS = 9

export function SpeedAnimationSlide({ report }) {
  const ranked = useMemo(() => rankEntries(report?.summary?.entries || []), [report])
  if (ranked.length < 2) return null

  const visible = ranked.slice(0, 6)
  const fastest = visible[0]?.opsPerSec || 1
  const sourceLabel = report?.summary?.dataSource === 'v8'
    ? 'Controlled V8 analysis'
    : report?.summary?.dataSource === 'quickjs'
      ? 'QuickJS baseline'
      : 'Aggregated browser runs'

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(16,185,129,0.25), transparent)"
      className="bg-gradient-to-br from-slate-50 via-white to-emerald-50 dark:from-slate-950 dark:via-slate-950 dark:to-emerald-950/30"
    >
      <SlideHeader icon={Activity} eyebrow="Speed animation" title="Watch the relative pace" />

      <div className="grid grid-cols-1 lg:grid-cols-[0.72fr_1.28fr] print:grid-cols-[0.72fr_1.28fr] gap-6 flex-1 min-h-0">
        <div className="flex flex-col justify-center gap-4">
          <div className="rounded-3xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 p-6">
            <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">Fastest case</div>
            <div className="mt-2 text-4xl font-black tracking-tight">{visible[0].title}</div>
            <div className="mt-3 text-5xl font-black text-emerald-700 dark:text-emerald-300">
              {formatOps(visible[0].opsPerSec)}
              <span className="ml-2 text-base font-semibold text-foreground/65">ops/sec</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 text-sm leading-relaxed text-foreground/80">
            Every ball crosses the same lane. Faster snippets get shorter lap
            times, so the visual rhythm matches the throughput spread in the report.
          </div>

          <p className="text-xs text-muted-foreground">
            Source: {sourceLabel} · top {visible.length} of {ranked.length} ranked tests.
          </p>
        </div>

        <div className="rounded-3xl border-2 border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 flex flex-col justify-center gap-5 overflow-hidden">
          {visible.map((entry, index) => {
            const color = SPEED_BALL_COLORS[index % SPEED_BALL_COLORS.length]
            const ratio = fastest > 0 ? entry.opsPerSec / fastest : 0
            const slowerRatio = ratio > 0 ? fastest / entry.opsPerSec : 1
            const lapSeconds = Math.min(
              SLOWEST_BALL_LAP_SECONDS,
              Math.max(FASTEST_BALL_LAP_SECONDS, FASTEST_BALL_LAP_SECONDS * slowerRatio)
            )
            const widthPct = `${Math.max(5, Math.min(100, ratio * 100))}%`
            const staticPosition = `${Math.max(7, Math.min(94, ratio * 100))}%`

            return (
              <div key={entry.testIndex ?? entry.title} className="space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="text-xs font-mono text-muted-foreground tabular-nums w-7">#{index + 1}</span>
                    <span className="truncate text-lg font-bold tracking-tight">{entry.title}</span>
                  </div>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-sm font-black tabular-nums" style={{ color }}>
                      {formatOps(entry.opsPerSec)}
                    </span>
                    {index > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {formatMultiplier(slowerRatio)} slower
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative h-12 overflow-hidden rounded-full border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/60">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full opacity-20"
                    style={{
                      width: widthPct,
                      background: `linear-gradient(90deg, ${color}, transparent)`,
                    }}
                  />
                  <div className="absolute inset-x-5 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-slate-300 dark:border-slate-700" />
                  <div
                    className="report-speed-ball absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full shadow-xl ring-2 ring-white/80 dark:ring-black/30"
                    style={{
                      background: color,
                      '--lap-duration': `${lapSeconds}s`,
                      '--lap-delay': `${index * -0.24}s`,
                      '--static-position': staticPosition,
                    }}
                  >
                    <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-white/75" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style jsx>{`
        .report-speed-ball {
          left: 1rem;
          animation: report-speed-lap var(--lap-duration) ease-in-out infinite alternate;
          animation-delay: var(--lap-delay);
        }

        @keyframes report-speed-lap {
          from {
            left: 1rem;
          }
          to {
            left: calc(100% - 3rem);
          }
        }

        @media (prefers-reduced-motion: reduce), print {
          .report-speed-ball {
            animation: none;
            left: clamp(1rem, calc(var(--static-position) - 2rem), calc(100% - 3rem));
          }
        }
      `}</style>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Winner spotlight                                            */
/* ------------------------------------------------------------------ */

export function WinnerSlide({ report }) {
  const leader = report?.summary?.leader
  const ranked = report?.summary?.ranked || []
  const second = ranked[1]
  if (!leader) return null

  const lead = second && second.opsPerSec > 0
    ? leader.opsPerSec / second.opsPerSec
    : null

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(16,185,129,0.35), transparent)"
      className="bg-gradient-to-br from-emerald-50 via-white to-emerald-50 dark:from-emerald-950/40 dark:via-slate-950 dark:to-slate-950"
    >
      <SlideHeader icon={Trophy} eyebrow="Winner" title={leader.title} />
      <div className="grid grid-cols-1 lg:grid-cols-5 print:grid-cols-5 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-2 print:col-span-2 flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/30 p-6">
            <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1 font-semibold">Speed</div>
            <div className="text-5xl font-bold text-emerald-700 dark:text-emerald-300">
              {formatOps(leader.opsPerSec)}
              <span className="ml-2 text-base font-medium text-foreground/70">ops/sec</span>
            </div>
            {lead && (
              <div className="mt-4 flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-500" />
                <span className="text-sm">
                  <span className="font-semibold">{formatMultiplier(lead)}</span>{' '}
                  ahead of {second.title}
                </span>
              </div>
            )}
          </div>
          <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 p-6 text-sm text-foreground/80">
            Picked because it produced the highest sustained throughput across the
            engines analysed for this benchmark.
          </div>
        </div>
        <div className="lg:col-span-3 print:col-span-3 min-h-0 flex flex-col">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 mt-[-24px]">Code</div>
          <div className="flex-1 min-h-0 print:min-h-[420px]">
            <CodeBlock code={leader.code} maxLines={18} language={report?.benchmark?.language} />
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Head to head (winner vs lagger)                             */
/* ------------------------------------------------------------------ */

export function HeadToHeadSlide({ report }) {
  const leader = report?.summary?.leader
  const lagger = report?.summary?.lagger
  if (!leader || !lagger || leader === lagger) return null
  const ratio = lagger.opsPerSec > 0 ? leader.opsPerSec / lagger.opsPerSec : null

  // Tinted tile styles — `bg-card` on the previous version resolved to
  // white in print and the tile vanished into the white page. We use
  // saturated emerald/rose backgrounds with thicker borders so each
  // tile reads as a distinct block in the PDF, and we drop
  // `backdrop-blur` because Chrome's print engine renders
  // `backdrop-filter` inconsistently (often as a fully transparent
  // layer that nukes anything behind it).
  const TILE_STYLES = {
    emerald: 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/30',
    rose: 'border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/30',
  }
  const VALUE_COLORS = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    rose: 'text-rose-700 dark:text-rose-300',
  }

  const Tile = ({ entry, color, label, badge }) => (
    <div className={`flex flex-col rounded-2xl border-2 ${TILE_STYLES[color]} p-6 min-h-[260px] print:min-h-[420px]`}>
      <div className="flex items-center justify-between mb-2">
        <Tag color={color}>{label}</Tag>
        {badge}
      </div>
      <div className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">{entry.title}</div>
      <div className={`text-3xl sm:text-4xl font-bold mb-4 ${VALUE_COLORS[color]}`}>
        {formatOps(entry.opsPerSec)}
        <span className="ml-2 text-sm font-medium text-muted-foreground">ops/sec</span>
      </div>
      <div className="flex-1 min-h-0">
        <CodeBlock code={entry.code} maxLines={10} language={report?.benchmark?.language} />
      </div>
    </div>
  )

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(244,63,94,0.2), transparent)"
      className="bg-gradient-to-br from-emerald-50 via-white to-rose-50 dark:from-emerald-950/30 dark:via-slate-950 dark:to-rose-950/30"
    >
      <SlideHeader icon={Zap} eyebrow="Head to head" title={ratio ? `${formatMultiplier(ratio)} difference` : 'Fastest vs slowest'} />
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-4 flex-1 min-h-0">
        <Tile entry={leader} color="emerald" label="Fastest" badge={<Trophy className="h-4 w-4 text-emerald-500" />} />
        <Tile entry={lagger} color="rose" label="Slowest" badge={<Gauge className="h-4 w-4 text-rose-500" />} />
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Credits                                                     */
/* ------------------------------------------------------------------ */

export function CreditsSlide({ report }) {
  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(139,92,246,0.4), transparent)"
      className="bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 text-white"
    >
      <div className="flex-1 flex flex-col justify-center max-w-3xl">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-violet-300 mb-4">
          <Rocket className="h-4 w-4" />
          <span>Thanks for watching</span>
        </div>
        <h2 className="text-4xl sm:text-6xl font-bold tracking-tight">
          Run it yourself.
        </h2>
        <p className="mt-4 text-lg text-violet-200/80 max-w-xl">
          Every benchmark on jsperf.net is reproducible. Open the source
          link, hit "Run", and watch the numbers light up in your browser.
        </p>

        <div className="mt-10 space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-violet-300/70 w-24">Source</span>
            <span className="font-mono text-white/90">
              jsperf.net/{report.slug}{report.revision > 1 ? `/${report.revision}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-violet-300/70 w-24">Generated</span>
            <span>{formatDate(report.createdAt)}</span>
          </div>
          {report.creator?.name && (
            <div className="flex items-center gap-3">
              <span className="text-violet-300/70 w-24">By</span>
              <span>{report.creator.name}</span>
            </div>
          )}
        </div>
      </div>
      <div className="text-xs text-violet-300/70">
        Powered by jsperf.net · presentation reports are a donor perk.
      </div>
    </SlideShell>
  )
}
