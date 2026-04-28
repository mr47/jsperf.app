import React, { useMemo } from 'react'
import { AlertTriangle, Brain, CheckCircle2, Gauge, Layers, ShieldAlert, Stethoscope } from 'lucide-react'

import MathNotation from '../../MathNotation'
import {
  collectComplexityResults,
  collectPredictionResults,
  formatPercent,
} from '../slideUtils'
import { SlideHeader, SlideShell, Tag } from './primitives'

/* ------------------------------------------------------------------ */
/*  Slide: Benchmark Doctor                                            */
/* ------------------------------------------------------------------ */

const DOCTOR_SEVERITY_META = {
  danger: {
    label: 'Danger',
    icon: ShieldAlert,
    card: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100',
    iconClass: 'text-rose-600 dark:text-rose-300',
    pill: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-100',
  },
  warning: {
    label: 'Warnings',
    icon: AlertTriangle,
    card: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
    iconClass: 'text-amber-600 dark:text-amber-300',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100',
  },
  info: {
    label: 'Notes',
    icon: AlertTriangle,
    card: 'border-slate-200 bg-white/80 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100',
    iconClass: 'text-violet-600 dark:text-violet-300',
    pill: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
}

export function BenchmarkDoctorSlide({ report }) {
  const doctor = report?.analysis?.doctor
  if (!doctor) return null

  const diagnostics = Array.isArray(doctor.diagnostics) ? doctor.diagnostics : []
  const summary = doctor.summary || {}
  const danger = Number(summary.danger) || diagnostics.filter(d => d.severity === 'danger').length
  const warning = Number(summary.warning) || diagnostics.filter(d => d.severity === 'warning').length
  const info = Number(summary.info) || diagnostics.filter(d => d.severity === 'info').length
  const total = Number(summary.total) || diagnostics.length
  const verdict = summary.verdict || (danger > 0 ? 'misleading' : total > 0 ? 'review' : 'clean')
  const isClean = verdict === 'clean' && total === 0
  const visible = diagnostics.slice(0, 3)
  const hidden = Math.max(0, diagnostics.length - visible.length)

  const verdictCopy = isClean
    ? {
        title: 'No obvious benchmark-shape issues',
        detail: 'Doctor did not detect dead-code, constant-folding, async, runtime, or variance warnings in this snapshot.',
        className: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
        icon: CheckCircle2,
      }
    : danger > 0
      ? {
          title: 'Likely misleading without fixes',
          detail: 'At least one finding can change what the benchmark appears to measure. Fix those before treating the winner as reliable.',
          className: 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100',
          icon: ShieldAlert,
        }
      : {
          title: 'Review before you trust the ranking',
          detail: 'The benchmark is usable, but Doctor found shape or measurement warnings worth calling out with the results.',
          className: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
          icon: Stethoscope,
        }
  const VerdictIcon = verdictCopy.icon

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(245,158,11,0.25), transparent)"
      className="bg-gradient-to-br from-amber-50 via-white to-violet-50 dark:from-amber-950/30 dark:via-slate-950 dark:to-violet-950/30"
    >
      <SlideHeader icon={Stethoscope} eyebrow="Benchmark Doctor" title="Can we trust the winner?" />

      <div className="grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] print:grid-cols-[0.82fr_1.18fr] gap-6 flex-1 min-h-0">
        <div className="flex flex-col gap-4">
          <div className={`rounded-3xl border-2 p-6 ${verdictCopy.className}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/70 dark:bg-black/20">
                <VerdictIcon className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.18em] font-semibold opacity-75">Verdict</div>
                <div className="mt-1 text-3xl font-black tracking-tight capitalize">{verdict}</div>
                <div className="mt-1 text-sm font-semibold opacity-85">{verdictCopy.title}</div>
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed opacity-85">{verdictCopy.detail}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['danger', danger],
              ['warning', warning],
              ['info', info],
            ].map(([severity, count]) => {
              const meta = DOCTOR_SEVERITY_META[severity]
              const Icon = meta.icon
              return (
                <div key={severity} className={`rounded-2xl border-2 p-4 ${meta.card}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] font-semibold opacity-75">{meta.label}</span>
                    <Icon className={`h-4 w-4 ${meta.iconClass}`} />
                  </div>
                  <div className="mt-2 text-4xl font-black tabular-nums">{count}</div>
                </div>
              )
            })}
          </div>

          <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 text-sm leading-relaxed text-foreground/80">
            Doctor checks for common microbenchmark traps before the deck asks anyone to trust an ops/sec winner.
          </p>
        </div>

        <div className="rounded-3xl border-2 border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-5 flex flex-col min-h-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">Findings</div>
              <div className="mt-1 text-2xl font-black tracking-tight">
                {total} {total === 1 ? 'finding' : 'findings'}
              </div>
            </div>
            {hidden > 0 && <Tag color="amber">+{hidden} more</Tag>}
          </div>

          {isClean ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-8 text-center">
              <div>
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-300" />
                <p className="mt-4 text-lg font-bold">Clean enough to present.</p>
                <p className="mt-2 text-sm text-foreground/70">
                  Keep validating with realistic data and the environments your users actually run.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 overflow-hidden">
              {visible.map((diagnostic) => {
                const severity = diagnostic.severity || 'info'
                const meta = DOCTOR_SEVERITY_META[severity] || DOCTOR_SEVERITY_META.info
                const Icon = meta.icon
                return (
                  <div key={diagnostic.id || `${diagnostic.title}-${diagnostic.testIndex}`} className={`rounded-2xl border-2 p-3 ${meta.card}`}>
                    <div className="flex items-start gap-2.5">
                      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.iconClass}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-bold leading-tight">{diagnostic.title}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.pill}`}>
                            {severity}
                          </span>
                        </div>
                        {diagnostic.testTitle && (
                          <div className="mt-0.5 text-[11px] font-medium opacity-75 truncate">{diagnostic.testTitle}</div>
                        )}
                        <p className="doctor-finding-copy mt-1 text-xs leading-relaxed opacity-85">{diagnostic.message}</p>
                        {diagnostic.recommendation && (
                          <p className="doctor-finding-copy mt-0.5 text-[11px] leading-relaxed opacity-75">{diagnostic.recommendation}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {hidden > 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  Showing the first 3 highest-priority findings. Re-run after fixing them to reveal lower-priority issues.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .doctor-finding-copy {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
      `}</style>
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

export function JitAmplificationSlide({ report }) {
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
/*  Slide: Static complexity                                           */
/* ------------------------------------------------------------------ */

export function ComplexitySlide({ report }) {
  const results = useMemo(() => collectComplexityResults(report), [report])
  if (!results.length) return null

  const visible = results.slice(0, 6)
  const hidden = Math.max(0, results.length - visible.length)
  const hasAsync = visible.some(r => r.complexity?.async?.mode && r.complexity.async.mode !== 'none')
  const timeOrder = ['constant', 'logarithmic', 'linear', 'linearithmic', 'quadratic', 'cubic', 'unknown']
  const timeKey = (complexity) => {
    const label = complexity?.time?.label
    if (label) return String(label).toLowerCase()
    const notation = String(complexity?.time?.notation || '').toLowerCase().replace(/\s+/g, '')
    if (notation === 'o(1)') return 'constant'
    if (notation === 'o(logn)') return 'logarithmic'
    if (notation === 'o(n)') return 'linear'
    if (notation === 'o(nlogn)') return 'linearithmic'
    if (notation === 'o(n^2)') return 'quadratic'
    if (notation === 'o(n^3)') return 'cubic'
    return 'unknown'
  }
  const timeRank = (complexity) => {
    const idx = timeOrder.indexOf(timeKey(complexity))
    return idx >= 0 ? idx : timeOrder.length - 1
  }
  const peak = [...results].sort((a, b) => timeRank(b.complexity) - timeRank(a.complexity))[0]
  const constantSpace = results.filter(r => r.complexity?.space?.notation === 'O(1)' || r.complexity?.space?.label === 'constant').length
  const linearOrBetter = results.filter(r => timeRank(r.complexity) <= timeOrder.indexOf('linear')).length

  const asyncLabel = (mode) => ({
    'single-await': 'single await',
    'sequential-await': 'sequential awaits',
    'async-iteration': 'async iteration',
    'parallel-fanout': 'Promise fan-out',
    race: 'Promise race',
    unknown: 'async',
  }[mode] || mode)

  return (
    <SlideShell
      accent="radial-gradient(closest-side, rgba(139,92,246,0.18), transparent)"
      className="bg-gradient-to-br from-slate-50 via-white to-violet-50 dark:from-slate-950 dark:via-slate-950 dark:to-violet-950/30"
    >
      <SlideHeader icon={Gauge} eyebrow="Static complexity" title="What the code shape suggests" />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-3xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50/70 dark:bg-violet-950/30 p-5">
          <div className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Peak time</div>
          <div className="mt-2 text-4xl font-black tracking-tight">
            <MathNotation value={peak?.complexity?.time?.notation} />
          </div>
          <div className="mt-2 text-sm text-muted-foreground truncate">{peak?.title || 'No test'}</div>
        </div>
        <div className="rounded-3xl border-2 border-sky-200 dark:border-sky-800/60 bg-sky-50/70 dark:bg-sky-950/30 p-5">
          <div className="text-xs uppercase tracking-wider text-sky-700 dark:text-sky-300 font-semibold">Space</div>
          <div className="mt-2 text-4xl font-black tracking-tight">{constantSpace}/{results.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">tests estimated as <MathNotation value="O(1)" /></div>
        </div>
        <div className="rounded-3xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-5">
          <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">Shape</div>
          <div className="mt-2 text-4xl font-black tracking-tight">{linearOrBetter}/{results.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">linear or better</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr] print:grid-cols-[1.35fr_0.65fr] gap-5 flex-1 min-h-0">
        <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 flex flex-col min-h-0">
          <div className="mb-4 grid grid-cols-[minmax(0,1fr)_120px_120px] gap-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div>Test</div>
            <div className="text-right">Time</div>
            <div className="text-right">Space</div>
          </div>
          <div className="space-y-4 overflow-hidden">
            {visible.map((r) => {
              const c = r.complexity || {}
              const asyncMode = c.async?.mode && c.async.mode !== 'none' ? c.async.mode : null
              const rank = timeRank(c)
              return (
                <div key={r.testIndex ?? r.title} className="grid grid-cols-[minmax(0,1fr)_120px_120px] gap-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/30 p-4">
                  <div className="min-w-0">
                    <div className="text-base font-semibold truncate">{r.title}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="grid flex-1 grid-cols-6 gap-1.5">
                        {timeOrder.slice(0, 6).map((key, i) => (
                          <div key={key} className={`h-2.5 rounded-full ${i === rank ? 'bg-violet-500' : 'bg-slate-200 dark:bg-slate-800'}`} />
                        ))}
                      </div>
                      {asyncMode && <Tag color="amber">{asyncLabel(asyncMode)}</Tag>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black tabular-nums">
                      <MathNotation value={c.time?.notation} />
                    </div>
                    {Number.isFinite(Number(c.time?.confidence)) && (
                      <div className="text-xs text-muted-foreground">{formatPercent(Number(c.time.confidence) * 100, 0)}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black tabular-nums">
                      <MathNotation value={c.space?.notation} />
                    </div>
                    <div className="text-xs text-muted-foreground">{c.space?.label || 'space'}</div>
                  </div>
                </div>
              )
            })}
            {hidden > 0 && (
              <p className="pt-3 text-xs text-muted-foreground">+{hidden} more test{hidden === 1 ? '' : 's'} not shown.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">How to read it</div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">
              The analyser scores the benchmark test body from its parsed code structure. Setup variables help identify context, but setup work is not charged to every test case.
            </p>
          </div>
          <div className="rounded-3xl border border-violet-200 dark:border-violet-800/60 bg-violet-50/70 dark:bg-violet-950/30 p-6">
            <div className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Estimate, not proof</div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">
              Dynamic calls, regular expressions, platform APIs, and parser recovery can reduce confidence. Use this beside the measured runtime data.
            </p>
          </div>
          {hasAsync && (
            <div className="rounded-3xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-6 text-sm">
              <span className="font-semibold">Async changes scheduling.</span>{' '}
              <span className="text-foreground/80">
                Big-O describes total work; awaits and Promise fan-out affect elapsed time and resource pressure.
              </span>
            </div>
          )}
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
export function InsightSlide({ report }) {
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
