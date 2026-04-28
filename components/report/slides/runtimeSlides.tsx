import React, { useMemo } from 'react'
import { Activity, Cpu, Gauge, Microscope, Monitor } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import SafeResponsiveContainer from '../../SafeResponsiveContainer'
import { runtimeHexColor, runtimePalette } from '../../../lib/runtimePalette'
import {
  aggregateRuntimeSources,
  aggregateStats,
  collectMemoryResponseSeries,
  collectPerfSamples,
  flattenRuntimes,
  formatOps,
  formatPercent,
  rankCompatibilityRows,
  speedColor,
  summarizeShareItems,
} from '../slideUtils'
import { SlideHeader, SlideShell } from './primitives'

/* ------------------------------------------------------------------ */
/*  Slide: Cross-runtime comparison                                    */
/* ------------------------------------------------------------------ */

export function RuntimesSlide({ report }) {
  const data = useMemo(() => {
    const flat = flattenRuntimes(report)
    if (!flat.length) return { rows: [], runtimes: [] }
    const rowsByTest = new Map<number, any>()
    const runtimes = new Set<string>()
    for (const slot of flat) {
      if (!rowsByTest.has(slot.testIndex)) {
        rowsByTest.set(slot.testIndex, { name: slot.testTitle })
      }
      const row = rowsByTest.get(slot.testIndex)
      row[slot.runtime] = slot.avgOpsPerSec
      runtimes.add(slot.runtime)
    }
    return { rows: [...rowsByTest.values()], runtimes: [...runtimes] }
  }, [report])

  if (!data.rows.length) return null

  return (
    <SlideShell accent="radial-gradient(closest-side, rgba(59,130,246,0.25), transparent)">
      <SlideHeader icon={Cpu} eyebrow="Cross-runtime" title="Node · Deno · Bun · friends" />
      <SafeResponsiveContainer className="flex-1 min-h-0">
        <BarChart data={data.rows} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={formatOps} />
          <Tooltip
            formatter={(value, name) => [formatOps(value) + ' ops/sec', name]}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data.runtimes.map(rt => (
            <Bar key={rt} dataKey={rt} fill={runtimeHexColor(rt)} radius={[6, 6, 0, 0]} />
          ))}
        </BarChart>
      </SafeResponsiveContainer>
      <p className="mt-4 text-xs text-muted-foreground">
        Same code executed on different JavaScript engines. Higher bars = faster.
      </p>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Compatibility matrix                                        */
/* ------------------------------------------------------------------ */

export function CompatibilityMatrixSlide({ report }) {
  const rows = useMemo(() => rankCompatibilityRows(report).slice(0, 5), [report])
  const environments = report?.compatibilityMatrix?.environments || []
  if (!rows.length || !environments.length) return null

  const measuredCells = rows.reduce(
    (sum, row) => sum + row.cells.filter(cell => cell.state === 'ok').length,
    0,
  )
  const totalCells = rows.length * environments.length

  return (
    <SlideShell accent="radial-gradient(closest-side, rgba(139,92,246,0.28), transparent)">
      <SlideHeader
        icon={Gauge}
        eyebrow="Boosted donor matrix"
        title="Compatibility across browsers and runtimes"
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <MetricTile label="Top score" value={formatScore(rows[0]?.score || 0)} detail={rows[0]?.title || 'No leader'} />
        <MetricTile label="Coverage" value={`${Math.round((measuredCells / Math.max(1, totalCells)) * 100)}%`} detail={`${measuredCells}/${totalCells} cells measured`} />
        <MetricTile label="Environments" value={String(environments.length)} detail="browser + controlled runtime slots" />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border bg-white/80 dark:bg-slate-900/70">
        <table className="h-full w-full text-[11px]">
          <thead>
            <tr className="border-b bg-slate-50 dark:bg-slate-800/60">
              <th className="w-10 px-2 py-2 text-left font-semibold text-muted-foreground">#</th>
              <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Test</th>
              <th className="w-16 px-2 py-2 text-right font-semibold text-muted-foreground">Score</th>
              {environments.map(env => (
                <th key={env.key} className="px-1.5 py-2 text-right font-semibold text-muted-foreground">
                  {env.shortLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <tr key={row.testIndex} className="align-middle">
                <td className="px-2 py-2 font-bold text-violet-600 dark:text-violet-300">{row.rank}</td>
                <td className="px-2 py-2">
                  <div className="truncate text-sm font-semibold">{row.title}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{row.insight}</div>
                </td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatScore(row.score)}</td>
                {environments.map(env => {
                  const cell = row.cells.find(entry => entry.environmentKey === env.key)
                  return (
                    <td key={env.key} className="px-1.5 py-2 text-right">
                      <span className={`inline-flex min-w-14 justify-center rounded-full border px-1.5 py-0.5 font-semibold tabular-nums ${matrixCellClass(cell)}`}>
                        {matrixCellLabel(cell)}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Included because this report was generated by a boosted donor. Values are frozen at report generation time.
      </p>
    </SlideShell>
  )
}

function MetricTile({ label, value, detail }) {
  return (
    <div className="rounded-2xl border bg-white/70 dark:bg-slate-900/70 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-black tracking-tight">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function matrixCellLabel(cell) {
  if (!cell) return '—'
  if (cell.state === 'ok') return formatOps(Number(cell.opsPerSec) || 0)
  if (cell.state === 'pending') return 'Pending'
  if (cell.state === 'failed') return 'Failed'
  if (cell.state === 'unsupported') return 'N/A'
  return '—'
}

function matrixCellClass(cell) {
  if (!cell) return 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'
  if (cell.state === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
  if (cell.state === 'unsupported') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
  if (cell.state !== 'ok') return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
  if (cell.comparison === 'wins') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
  if (cell.comparison === 'loses') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
  if (cell.comparison === 'irrelevant') return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
  return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200'
}

function formatScore(score) {
  return score > 0 ? `+${score}` : String(score)
}

/* ------------------------------------------------------------------ */
/*  Slide: Hardware perf counters (radar)                              */
/* ------------------------------------------------------------------ */

export function PerfCountersSlide({ report }) {
  const data = useMemo(() => {
    const samples = collectPerfSamples(report)
    if (!samples.length) return null

    const byRuntime = new Map()
    for (const s of samples) {
      if (!byRuntime.has(s.runtime)) byRuntime.set(s.runtime, [])
      byRuntime.get(s.runtime).push(s)
    }
    // Pick the runtime with the most observations (usually node).
    const dominant = [...byRuntime.entries()].sort((a, b) => b[1].length - a[1].length)[0]
    const dominantSamples = dominant?.[1] || []

    // De-dupe: one sample per test (latest wins). Avoids two profiles
    // for the same test stacking on the radar.
    const perTest = new Map()
    for (const s of dominantSamples) perTest.set(s.testTitle, s)
    const finalSamples = [...perTest.values()]

    // Drop axes nobody captured a value for — otherwise the radar
    // collapses to a sliver because most spokes are pinned at zero.
    // We keep a label map so the visible axis text stays human-friendly
    // (camelCase keys like "branchMisses" render as "Branch misses").
    const METRIC_LABELS = {
      cycles: 'Cycles',
      instructions: 'Instructions',
      cacheMisses: 'Cache misses',
      cacheReferences: 'Cache refs',
      branches: 'Branches',
      branchMisses: 'Branch misses',
      pageFaults: 'Page faults',
      contextSwitches: 'Ctx switches',
    }
    const candidateMetrics = [
      'cycles', 'instructions',
      'branches', 'branchMisses',
      'cacheMisses', 'cacheReferences',
      'pageFaults', 'contextSwitches',
    ]
    const metrics = candidateMetrics.filter(m =>
      finalSamples.some(s => Number(s.counters?.[m]) > 0)
    )
    if (metrics.length < 3) return null

    const maxByMetric = Object.fromEntries(metrics.map(m => [
      m, Math.max(...finalSamples.map(s => Number(s.counters[m]) || 0), 1)
    ]))

    const radarData = metrics.map(m => {
      const row = { metric: METRIC_LABELS[m] || m }
      for (const s of finalSamples) {
        row[s.testTitle] = (Number(s.counters[m]) || 0) / maxByMetric[m]
      }
      return row
    })

    return { radarData, runtime: dominant?.[0], tests: finalSamples.map(s => s.testTitle) }
  }, [report])

  if (!data) return null

  const palette = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#06b6d4']

  return (
    <SlideShell accent="radial-gradient(closest-side, rgba(139,92,246,0.25), transparent)">
      <SlideHeader icon={Microscope} eyebrow="Hardware perf counters" title={`What the CPU sees · ${data.runtime}`} />
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 print:grid-cols-3 gap-6">
        <SafeResponsiveContainer className="lg:col-span-2 print:col-span-2 h-full min-h-0">
          <RadarChart data={data.radarData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
            {/* Domain runs to 1.25 instead of 1 so the largest sample
                on each axis sits at ~80% of the rim instead of being
                pinned to the very edge — gives the polygon room to
                breathe and stops labels from clipping at the corners. */}
            <PolarRadiusAxis angle={30} tick={false} domain={[0, 1.25]} />
            {data.tests.map((t, i) => (
              <Radar
                key={t + i}
                name={t}
                dataKey={t}
                stroke={palette[i % palette.length]}
                fill={palette[i % palette.length]}
                fillOpacity={0.18}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => [(v * 100).toFixed(0) + '% of max', '']} />
          </RadarChart>
        </SafeResponsiveContainer>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Values are normalised per metric — the test using the most of
            something on a given axis sits near the outer ring (≈80% of
            the rim, leaving headroom so the labels don't clip).
          </p>
          <ul className="space-y-2">
            {(() => {
              const descriptions = {
                Cycles: 'Total CPU cycles spent',
                Instructions: 'Total instructions retired',
                Branches: 'Conditional jumps taken',
                'Branch misses': 'Mispredicted branches — pipeline stalls',
                'Cache misses': 'Last-level cache misses — DRAM trips',
                'Cache refs': 'Last-level cache lookups',
                'Page faults': 'Memory pages brought in by the kernel',
                'Ctx switches': 'Times the OS swapped this thread out',
              }
              return data.radarData
                .map(row => row.metric)
                .filter(label => descriptions[label])
                .map(label => (
                  <li key={label} className="leading-tight">
                    <span className="font-semibold">{label}.</span>{' '}
                    <span className="text-muted-foreground">{descriptions[label]}</span>
                  </li>
                ))
            })()}
          </ul>
        </div>
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Memory response                                             */
/* ------------------------------------------------------------------ */

const SCALING_LABELS = {
  linear: 'improves linearly with more memory headroom',
  sublinear: 'improves with diminishing returns',
  plateau: 'is stable across memory limits',
  degrading: 'slows down as memory pressure changes',
  noisy: 'is noisy across memory limits',
  'insufficient-data': 'has insufficient data',
}

const MIN_MODEL_READOUT_CONFIDENCE = 0.5

function scalingConfidence(series) {
  const confidence = Number(series?.prediction?.scalingConfidence)
  return Number.isFinite(confidence) ? confidence : 0
}

function hasReliableScalingPrediction(series) {
  const type = series?.prediction?.scalingType
  if (!type || type === 'noisy' || type === 'insufficient-data') return false

  const confidence = Number(series.prediction.scalingConfidence)
  return !Number.isFinite(confidence) || confidence >= MIN_MODEL_READOUT_CONFIDENCE
}

export function MemoryResponseSlide({ report }) {
  const response = useMemo(() => collectMemoryResponseSeries(report), [report])
  if (!response) return null

  const predictions = response.series
    .filter(hasReliableScalingPrediction)
    .sort((a, b) => scalingConfidence(b) - scalingConfidence(a))
    .slice(0, 4)

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(14,165,233,0.22), transparent)"
      className="bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:from-sky-950/40 dark:via-slate-950 dark:to-cyan-950/30"
    >
      <SlideHeader icon={Activity} eyebrow="Memory response" title="Throughput under memory limits" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr] print:grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-0">
        <SafeResponsiveContainer className="h-full min-h-0 rounded-2xl border-2 border-sky-200 dark:border-sky-800/60 bg-white/75 dark:bg-slate-900/60 p-4">
          <LineChart data={response.data} margin={{ top: 8, right: 24, bottom: 20, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="resource" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={formatOps} />
            <Tooltip
              formatter={(value, name) => [formatOps(value) + ' ops/sec', response.series.find(s => s.key === name)?.title || name]}
              contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Legend
              formatter={(value) => response.series.find(s => s.key === value)?.title || value}
              wrapperStyle={{ fontSize: 12 }}
            />
            {response.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.title}
                stroke={speedColor(i, response.series.length)}
                strokeWidth={3}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            ))}
          </LineChart>
        </SafeResponsiveContainer>

        <div className="flex flex-col gap-4 text-sm">
          <div className="rounded-2xl border-2 border-sky-200 dark:border-sky-800/60 bg-sky-50/80 dark:bg-sky-950/30 p-5">
            <div className="text-xs uppercase tracking-wider text-sky-700 dark:text-sky-300 mb-1 font-semibold">Source</div>
            <p className="text-foreground/80">
              {response.source === 'v8'
                ? 'Multi-point V8 profiles were available, so this chart uses production-like JIT measurements.'
                : 'QuickJS memory-limit profiles power this chart, giving a deterministic view of allocation pressure.'}
            </p>
          </div>

          {predictions.length > 0 && (
            <div className="rounded-2xl border-2 border-cyan-200 dark:border-cyan-800/60 bg-cyan-50/70 dark:bg-cyan-950/30 p-5">
              <div className="text-xs uppercase tracking-wider text-cyan-700 dark:text-cyan-300 mb-3 font-semibold">Model readout</div>
              <div className="space-y-3">
                {predictions.map((s) => {
                  const label = SCALING_LABELS[s.prediction.scalingType] || s.prediction.scalingType
                  const confidence = Number(s.prediction.scalingConfidence)
                  return (
                    <div key={s.key}>
                      <div className="font-semibold leading-tight">{s.title}</div>
                      <p className="text-xs leading-relaxed text-foreground/75">
                        {label}
                        {Number.isFinite(confidence) && (
                          <> · {formatPercent(confidence * 100, 0)} confidence</>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Useful for spotting snippets that plateau early, degrade under pressure, or keep scaling as memory headroom grows.
          </p>
        </div>
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Methodology                                                 */
/* ------------------------------------------------------------------ */

export function MethodologySlide({ report }) {
  const agg = useMemo(() => aggregateStats(report?.stats), [report])
  const runtimeSources = useMemo(() => aggregateRuntimeSources(report), [report])
  const topBrowsers = summarizeShareItems(agg.browsers, 3)
  const topOSes = summarizeShareItems(agg.oses, 3)
  const visibleRuntimes = runtimeSources.runtimes.slice(0, 6)
  const hiddenRuntimeCount = Math.max(0, runtimeSources.runtimes.length - visibleRuntimes.length)
  const runtimeLabel = (runtime) => {
    const meta = runtimePalette(runtime)
    const version = typeof runtime === 'string' && runtime.includes('@')
      ? runtime.slice(runtime.indexOf('@') + 1)
      : null
    return version ? `${meta.label} ${version}` : meta.label
  }

  const Bar = ({ items }) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
    return (
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={item.name} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium truncate">{item.name}</span>
              <span className="text-muted-foreground">{(item.share * 100).toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(2, item.share * 100)}%`, background: colors[i % colors.length] }}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(59,130,246,0.25), transparent)"
      className="bg-gradient-to-br from-sky-50 via-white to-indigo-50 dark:from-sky-950/40 dark:via-slate-950 dark:to-indigo-950/40"
    >
      <SlideHeader icon={Monitor} eyebrow="Methodology" title="Where these numbers came from" />
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] print:grid-cols-[0.85fr_1.15fr] gap-4">
          <div className="rounded-2xl border-2 border-sky-200 dark:border-sky-800/60 bg-sky-50/80 dark:bg-sky-950/30 p-5">
            <div className="text-xs uppercase tracking-wider text-sky-700 dark:text-sky-300 mb-1 font-semibold">Browser runs</div>
            <div className="text-5xl font-bold text-sky-900 dark:text-sky-100">{agg.totalRuns.toLocaleString('en')}</div>
            <p className="mt-2 text-xs leading-relaxed text-foreground/80">
              Public benchmark executions used for the leaderboard and environment breakdowns.
            </p>
          </div>
          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-5">
            <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1 font-semibold">Controlled runtimes</div>
            <div className="text-5xl font-bold text-emerald-900 dark:text-emerald-100">{runtimeSources.runtimes.length}</div>
            <p className="mt-2 text-xs leading-relaxed text-foreground/80">
              Node / Deno / Bun worker data across{' '}
              <span className="font-semibold">{runtimeSources.totalRuntimeSlots}</span>{' '}
              single-core test-runtime pairs
              {runtimeSources.totalProfiles > 0 && (
                <> and <span className="font-semibold">{runtimeSources.totalProfiles}</span> captured profile{runtimeSources.totalProfiles === 1 ? '' : 's'}</>
              )}.
            </p>
            {visibleRuntimes.length > 0 && (
              <div className="mt-3 grid grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-2 text-[11px]">
                {visibleRuntimes.map(rt => (
                  <div key={rt.runtime} className="min-w-0 rounded-lg bg-white/70 dark:bg-slate-950/40 border border-white/60 dark:border-white/10 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 font-semibold min-w-0">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: runtimeHexColor(rt.runtime) }}
                      />
                      <span className="truncate">{runtimeLabel(rt.runtime)}</span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground truncate">
                      {rt.tests} test{rt.tests === 1 ? '' : 's'} · {formatOps(rt.avgOpsPerSec)} avg
                    </div>
                  </div>
                ))}
                {hiddenRuntimeCount > 0 && (
                  <div className="rounded-lg bg-white/50 dark:bg-slate-950/30 border border-white/60 dark:border-white/10 px-2 py-1.5 text-muted-foreground flex items-center">
                    +{hiddenRuntimeCount} more target{hiddenRuntimeCount === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-5">
            <div className="text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-3 font-semibold">Top browsers</div>
            {topBrowsers.length
              ? <Bar items={topBrowsers} />
              : <p className="text-sm text-muted-foreground">No browser breakdown available.</p>}
          </div>
          <div className="rounded-2xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50/60 dark:bg-violet-950/30 p-5">
            <div className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-3 font-semibold">Top operating systems</div>
            {topOSes.length
              ? <Bar items={topOSes} />
              : <p className="text-sm text-muted-foreground">No OS breakdown available.</p>}
          </div>
        </div>
      </div>
    </SlideShell>
  )
}
