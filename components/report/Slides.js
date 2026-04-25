/**
 * Individual slide components for the report viewer.
 *
 * Each slide is a self-contained React component that receives the
 * full report document and pulls only what it needs. This way the
 * deck composition (in slideUtils.buildDeck) is the single source of
 * truth for which slides exist, and the viewer just iterates.
 *
 * Visual design is deliberately bold and high-contrast — these slides
 * are meant to be projected and readable from across a meeting room.
 */
import React, { useMemo } from 'react'
import {
  Trophy,
  Crown,
  Sparkles,
  Cpu,
  Gauge,
  Microscope,
  Brain,
  Rocket,
  Monitor,
  Zap,
  Activity,
  Layers,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from 'recharts'
import {
  formatOps,
  formatMultiplier,
  formatDate,
  formatPercent,
  speedColor,
  rankEntries,
  aggregateStats,
  aggregateRuntimeSources,
  summarizeShareItems,
  flattenRuntimes,
  collectPerfSamples,
  collectPredictionResults,
  collectMemoryResponseSeries,
} from './slideUtils'
import { runtimeHexColor, runtimePalette } from '../../lib/runtimePalette'
import { highlightSanitizedJS } from '../../utils/hljs'

/* ------------------------------------------------------------------ */
/*  Building blocks                                                    */
/* ------------------------------------------------------------------ */

function SlideShell({ children, className = '', accent }) {
  return (
    <div className={`relative h-full w-full overflow-hidden p-6 sm:p-10 lg:p-16 flex flex-col ${className}`}>
      {accent && (
        <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-60" aria-hidden>
          <div
            className="absolute -top-32 -right-32 h-96 w-96 rounded-full blur-3xl"
            style={{ background: accent }}
          />
        </div>
      )}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {children}
      </div>
    </div>
  )
}

function SlideHeader({ icon: Icon, eyebrow, title }) {
  return (
    <div className="mb-6 sm:mb-10">
      {eyebrow && (
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400">
          {Icon && <Icon className="h-4 w-4" />}
          <span>{eyebrow}</span>
        </div>
      )}
      {title && (
        <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
          {title}
        </h2>
      )}
    </div>
  )
}

/** Inline ribbon tag, used for "fastest" / "slowest" / runtime labels. */
function Tag({ children, color = 'slate' }) {
  const palette = {
    slate: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  }[color] || palette?.slate
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${palette}`}>
      {children}
    </span>
  )
}

/**
 * Syntax-highlighted code block. Uses the project's existing hljs
 * helper (DOMPurify-sanitised) so the same JS-friendly subset and the
 * GitHub theme injected by ReportViewer apply uniformly across the
 * benchmark page and the report.
 *
 * The block stretches to fill its parent (`h-full w-full`), so a
 * three-line snippet doesn't float at the top of a tall column on
 * the Winner / HeadToHead slides — it sits in a properly-sized panel
 * with the code anchored at the top. `maxLines` still clips
 * pathologically long bodies so the panel can't push other slide
 * content off-screen.
 *
 * Print note: we deliberately use `overflow-hidden` (not `auto`)
 * because Chrome's print engine renders `overflow:auto` panes inside
 * deeply nested flex/grid layouts as a 0-height scroll viewport,
 * leaving the code panel blank in the PDF. The maxLines clipping
 * already guarantees the snippet fits, so a hard clip is safe.
 */
function CodeBlock({ code, maxLines = 12 }) {
  const lines = (code || '').split('\n')
  const truncated = lines.length > maxLines
  const shown = truncated ? lines.slice(0, maxLines).join('\n') + '\n…' : (code || '')
  const html = useMemo(() => {
    try { return highlightSanitizedJS(shown) }
    catch (_) { return null }
  }, [shown])

  if (!shown.trim()) {
    return (
      <div className="h-full w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 text-xs text-muted-foreground italic flex items-center justify-center">
        No code captured for this test.
      </div>
    )
  }

  return (
    <pre className="block w-full h-full max-h-full overflow-hidden print:overflow-visible print:h-auto print:max-h-none rounded-lg text-xs sm:text-sm p-4 font-mono leading-relaxed border bg-[#f6f8fa] dark:bg-[#0d1117] border-slate-200 dark:border-slate-800 m-0 whitespace-pre">
      {html
        ? <code className="hljs language-javascript block" dangerouslySetInnerHTML={{ __html: html }} />
        : <code className="hljs language-javascript block">{shown}</code>}
    </pre>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Title                                                       */
/* ------------------------------------------------------------------ */

function TitleSlide({ report }) {
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

function LeaderboardSlide({ report }) {
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
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
      </div>
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
/*  Slide: Winner spotlight                                            */
/* ------------------------------------------------------------------ */

function WinnerSlide({ report }) {
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
            <CodeBlock code={leader.code} maxLines={18} />
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Head to head (winner vs lagger)                             */
/* ------------------------------------------------------------------ */

function HeadToHeadSlide({ report }) {
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
        <CodeBlock code={entry.code} maxLines={10} />
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
/*  Slide: Cross-runtime comparison                                    */
/* ------------------------------------------------------------------ */

function RuntimesSlide({ report }) {
  const data = useMemo(() => {
    const flat = flattenRuntimes(report)
    if (!flat.length) return { rows: [], runtimes: [] }
    const rowsByTest = new Map()
    const runtimes = new Set()
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
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Same code executed on different JavaScript engines. Higher bars = faster.
      </p>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Hardware perf counters (radar)                              */
/* ------------------------------------------------------------------ */

function PerfCountersSlide({ report }) {
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
        <div className="lg:col-span-2 print:col-span-2 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
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
          </ResponsiveContainer>
        </div>
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
/*  Slide: JIT amplification                                           */
/* ------------------------------------------------------------------ */

const CHARACTERISTIC_LABELS = {
  cpuBound: { label: 'CPU-bound', color: 'violet' },
  memoryBound: { label: 'Memory-bound', color: 'amber' },
  allocationHeavy: { label: 'Allocation-heavy', color: 'rose' },
  jitFriendly: { label: 'JIT-friendly', color: 'emerald' },
  v8Unavailable: { label: 'V8 unavailable', color: 'slate' },
}

function JitAmplificationSlide({ report }) {
  const results = useMemo(() => {
    return collectPredictionResults(report)
      .filter(r => Number(r.prediction?.jitBenefit) > 0 || r.prediction?.characteristics)
  }, [report])

  if (!results.length) return null

  const sorted = [...results].sort((a, b) =>
    (Number(b.prediction?.jitBenefit) || 0) - (Number(a.prediction?.jitBenefit) || 0)
  )
  const maxJitBenefit = Math.max(...sorted.map(r => Number(r.prediction?.jitBenefit) || 0), 1)
  const top = sorted[0]
  const visible = sorted.slice(0, 6)
  const hidden = Math.max(0, sorted.length - visible.length)
  const hasDivergence = report?.analysis?.comparison?.divergence && sorted.length > 1

  const takeaway = maxJitBenefit > 10
    ? 'This benchmark is highly sensitive to V8 optimization. Treat the winner as engine-dependent and re-check other runtimes before generalising.'
    : maxJitBenefit > 3
      ? 'V8 gives a meaningful boost, but algorithmic differences still matter.'
      : 'JIT amplification is modest. The result is mostly driven by the underlying algorithm.'

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(139,92,246,0.25), transparent)"
      className="bg-gradient-to-br from-violet-50 via-white to-slate-50 dark:from-violet-950/40 dark:via-slate-950 dark:to-slate-950"
    >
      <SlideHeader icon={Layers} eyebrow="JIT amplification" title="How much the optimizer helped" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] print:grid-cols-[1.1fr_0.9fr] gap-6 flex-1 min-h-0">
        <div className="rounded-2xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50/70 dark:bg-violet-950/30 p-5 flex flex-col min-h-0">
          <div className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-4 font-semibold">Per-test boost</div>
          <div className="space-y-4 overflow-hidden">
            {visible.map((r) => {
              const benefit = Number(r.prediction?.jitBenefit) || 0
              const width = Math.max(4, (benefit / maxJitBenefit) * 100)
              const characteristics = r.prediction?.characteristics || {}
              return (
                <div key={r.testIndex ?? r.title}>
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <span className="font-semibold truncate">{r.title}</span>
                    <span className="text-lg font-bold tabular-nums">{benefit > 0 ? `${benefit}×` : '—'}</span>
                  </div>
                  <div className="h-3 rounded-full bg-white dark:bg-slate-900/70 overflow-hidden border border-violet-100 dark:border-violet-900">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(characteristics).map(([key, value]) => {
                      if (!value || !CHARACTERISTIC_LABELS[key]) return null
                      const meta = CHARACTERISTIC_LABELS[key]
                      return <Tag key={key} color={meta.color}>{meta.label}</Tag>
                    })}
                  </div>
                </div>
              )
            })}
            {hidden > 0 && (
              <p className="text-xs text-muted-foreground">+{hidden} more test{hidden === 1 ? '' : 's'} not shown.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-6">
            <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1 font-semibold">Most JIT-sensitive</div>
            <div className="text-3xl font-bold tracking-tight">{top.title}</div>
            <p className="mt-2 text-sm text-foreground/80">
              V8 ran this snippet <span className="font-semibold">{Number(top.prediction?.jitBenefit) || 0}×</span>{' '}
              faster than the interpreter baseline.
            </p>
          </div>
          {hasDivergence && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/60 p-5 text-sm">
              <span className="font-semibold">Winner changes with the JIT.</span>{' '}
              <span className="text-foreground/80">
                The interpreter and V8 disagree, so optimizer behavior is part of the story.
              </span>
            </div>
          )}
          <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 text-sm text-foreground/80">
            {takeaway}
          </div>
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

function MemoryResponseSlide({ report }) {
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
        <div className="min-h-0 rounded-2xl border-2 border-sky-200 dark:border-sky-800/60 bg-white/75 dark:bg-slate-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
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
          </ResponsiveContainer>
        </div>

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
/*  Slide: AI insight                                                  */
/* ------------------------------------------------------------------ */

/**
 * The analysis pipeline emits a structured `comparison`:
 *   { fastestByAlgorithm, fastestByRuntime, divergence }
 *
 * `fastestByAlgorithm` is the test that the deterministic QuickJS run
 * picks as fastest (i.e. fastest "on paper"); `fastestByRuntime` is
 * the one V8's JIT actually wins with. When they disagree, the
 * benchmark is JIT-sensitive — a useful, story-worthy fact.
 *
 * If we ever attach prose (e.g. via an LLM later), we surface that
 * verbatim instead.
 */
function InsightSlide({ report }) {
  const insight = report?.analysis?.comparison
  if (!insight) return null

  const text = typeof insight === 'string'
    ? insight
    : (insight.summary || insight.text || null)

  const tests = report?.analysis?.results || []
  const algoIdx = typeof insight === 'object' ? insight.fastestByAlgorithm : -1
  const rtIdx = typeof insight === 'object' ? insight.fastestByRuntime : -1
  const algo = algoIdx >= 0 ? tests.find(r => r.testIndex === algoIdx) : null
  const rt = rtIdx >= 0 ? tests.find(r => r.testIndex === rtIdx) : null
  const divergence = typeof insight === 'object' && insight.divergence
  const sameWinner = algo && rt && algoIdx === rtIdx

  // Always provide a default narrative so the slide is never just a
  // header on a blank page — important for the printed PDF, where
  // sparse cards on a near-white background can otherwise read as
  // "empty" even when content technically exists.
  const intro = text || (
    divergence
      ? 'The interpreter and the optimising compiler disagree on the fastest test — a hallmark of a JIT-sensitive benchmark. The numbers reflect what V8 chose to inline and specialise, not just raw algorithmic cost.'
      : sameWinner
        ? 'The same test wins both with and without the optimising compiler — a sign that the result is driven by genuine algorithmic differences, not by a quirk of V8\'s JIT.'
        : 'These results compare what the algorithm "should" do (interpreted, deterministic) against what V8\'s JIT actually delivers in production — the difference between paper performance and felt performance.'
  )

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(244,63,94,0.25), transparent)"
      className="bg-gradient-to-br from-violet-50 via-white to-rose-50 dark:from-violet-950/40 dark:via-slate-950 dark:to-rose-950/40"
    >
      <SlideHeader icon={Brain} eyebrow="Analyst's take" title="What the data means" />
      <div className="flex-1 min-h-0 flex flex-col gap-5">
        <div className="max-w-3xl text-base sm:text-lg leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {intro}
        </div>

        {(algo || rt) && (
          sameWinner ? (
            <div className="max-w-4xl rounded-2xl border-2 border-emerald-300/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-950/30 p-6">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Tag color="emerald">Wins on paper</Tag>
                <Tag color="violet">Wins in production</Tag>
              </div>
              <div className="text-2xl sm:text-3xl font-bold tracking-tight">
                {algo.title || `Test ${algoIdx + 1}`}
              </div>
              <p className="mt-2 text-sm sm:text-base text-foreground/80">
                Fastest under both QuickJS (no JIT) and V8 (with JIT). The
                algorithmic edge is real — V8 didn't have to bend over
                backwards to make it look good.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4 max-w-4xl">
              {algo && (
                <div className="rounded-2xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50/80 dark:bg-violet-950/30 p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag color="violet">Best on paper</Tag>
                    <span className="text-xs text-muted-foreground">QuickJS interpreter</span>
                  </div>
                  <div className="text-xl font-semibold tracking-tight">{algo.title || `Test ${algoIdx + 1}`}</div>
                  <p className="mt-1 text-sm text-foreground/80">
                    Fastest in a deterministic, JIT-free environment — reflects pure
                    algorithmic complexity.
                  </p>
                </div>
              )}
              {rt && (
                <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag color="emerald">Best in production</Tag>
                    <span className="text-xs text-muted-foreground">V8 with JIT</span>
                  </div>
                  <div className="text-xl font-semibold tracking-tight">{rt.title || `Test ${rtIdx + 1}`}</div>
                  <p className="mt-1 text-sm text-foreground/80">
                    Fastest under the optimising compiler — what your users will
                    actually feel.
                  </p>
                </div>
              )}
            </div>
          )
        )}

        {divergence && algo && rt && !sameWinner && (
          <div className="max-w-3xl rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/60 px-4 py-3 text-sm">
            <span className="font-semibold">JIT-sensitive benchmark.</span>{' '}
            <span className="text-foreground/80">
              The interpreter and the optimising compiler disagree on the winner — a
              strong signal that micro-optimisations here depend heavily on V8's
              inlining and shape feedback. Re-validate before generalising.
            </span>
          </div>
        )}

        {!algo && !rt && (
          <p className="text-base text-muted-foreground">
            The analyser couldn't pick a clear winner from this run.
          </p>
        )}
      </div>
    </SlideShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Slide: Methodology                                                 */
/* ------------------------------------------------------------------ */

function MethodologySlide({ report }) {
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

/* ------------------------------------------------------------------ */
/*  Slide: Credits                                                     */
/* ------------------------------------------------------------------ */

function CreditsSlide({ report }) {
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

/* ------------------------------------------------------------------ */
/*  Public registry                                                    */
/* ------------------------------------------------------------------ */

export const SLIDE_COMPONENTS = {
  title: TitleSlide,
  leaderboard: LeaderboardSlide,
  winner: WinnerSlide,
  headToHead: HeadToHeadSlide,
  runtimes: RuntimesSlide,
  perfCounters: PerfCountersSlide,
  jitAmplification: JitAmplificationSlide,
  memoryResponse: MemoryResponseSlide,
  insight: InsightSlide,
  methodology: MethodologySlide,
  credits: CreditsSlide,
}

export const SLIDE_LABELS = {
  title: 'Title',
  leaderboard: 'Leaderboard',
  winner: 'Winner',
  headToHead: 'Head to head',
  runtimes: 'Runtimes',
  perfCounters: 'Perf counters',
  jitAmplification: 'JIT boost',
  memoryResponse: 'Memory',
  insight: 'Insight',
  methodology: 'Methodology',
  credits: 'Credits',
}
