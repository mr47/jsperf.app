/**
 * MobileReportViewer
 *
 * A standalone, mobile-first rendering of a jsPerf report. Designed to
 * replace the 16:9 slide viewer on small screens where projector-style
 * slides + Recharts canvases simply don't fit. Everything here is a
 * vertical scroll: short cards, native HTML bars instead of charts,
 * monospace code blocks with horizontal scroll, big tap targets.
 *
 * The desktop slide viewer (ReportViewer) renders this for screens
 * below the `md` breakpoint. Both share the same `report` shape and
 * the same printable stack lives in the parent so PDF export keeps
 * working.
 */
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown,
  Trophy,
  Crown,
  Sparkles,
  Cpu,
  Gauge,
  Brain,
  Monitor,
  Zap,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Presentation,
} from 'lucide-react'
import {
  formatOps,
  formatMultiplier,
  formatDate,
  speedColor,
  rankEntries,
  aggregateStats,
  aggregateRuntimeSources,
  flattenRuntimes,
} from './slideUtils'
import { runtimeHexColor, runtimePalette } from '../../lib/runtimePalette'
import { highlightSanitizedJS } from '../../utils/hljs'

/* --------------------------------- atoms --------------------------------- */

function SectionCard({ icon: Icon, eyebrow, title, accent = 'violet', children }) {
  const accents = {
    violet: 'text-violet-600 dark:text-violet-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    sky: 'text-sky-600 dark:text-sky-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }
  return (
    <section className="rounded-2xl border bg-white dark:bg-slate-900 p-5 shadow-sm">
      {(eyebrow || title) && (
        <header className="mb-4">
          {eyebrow && (
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${accents[accent]}`}>
              {Icon && <Icon className="h-3.5 w-3.5" />}
              <span>{eyebrow}</span>
            </div>
          )}
          {title && (
            <h2 className="mt-1.5 text-xl font-bold tracking-tight leading-tight">
              {title}
            </h2>
          )}
        </header>
      )}
      {children}
    </section>
  )
}

function Pill({ children, color = 'slate' }) {
  const palette = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  }[color]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${palette}`}>
      {children}
    </span>
  )
}

/**
 * Collapsible code block. On mobile, every snippet starts collapsed so
 * the page stays scannable; tapping reveals the full body with
 * horizontal scroll preserved for long lines.
 */
function MobileCode({ code, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const trimmed = (code || '').trim()
  const lineCount = trimmed ? trimmed.split('\n').length : 0
  const html = useMemo(() => {
    if (!open || !trimmed) return null
    try { return highlightSanitizedJS(trimmed) }
    catch (_) { return null }
  }, [open, trimmed])

  if (!trimmed) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs italic text-muted-foreground text-center">
        No code captured.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-[#f6f8fa] dark:bg-[#0d1117] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>{open ? 'Hide code' : 'View code'} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <pre className="m-0 px-3 pb-3 pt-0 text-[11.5px] leading-relaxed font-mono overflow-x-auto whitespace-pre">
          {html
            ? <code className="hljs language-javascript block" dangerouslySetInnerHTML={{ __html: html }} />
            : <code className="hljs language-javascript block">{trimmed}</code>}
        </pre>
      )}
    </div>
  )
}

/* -------------------------------- sections ------------------------------- */

function HeroSection({ report }) {
  const { title, benchmark, summary, createdAt, creator } = report
  const headline = summary?.speedup ? formatMultiplier(summary.speedup) : null

  return (
    <section className="rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 text-white p-5 shadow-md">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300/90">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Performance Report</span>
      </div>

      <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight">{title}</h1>

      {benchmark?.authorName && (
        <p className="mt-1.5 text-sm text-violet-200/80">
          by <span className="font-medium text-white">{benchmark.authorName}</span>
        </p>
      )}

      {headline && summary?.leader && summary?.lagger && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
          <div className="text-3xl font-bold text-emerald-300">{headline}</div>
          <div className="mt-1 text-xs text-violet-100/90 leading-snug">
            <span className="font-semibold text-white">{summary.leader.title}</span>
            {' faster than '}
            <span className="font-semibold text-white">{summary.lagger.title}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-[11px] text-violet-200/70">
        <span>{formatDate(createdAt)}</span>
        {creator?.name && <span>by {creator.name}</span>}
      </div>
    </section>
  )
}

function LeaderboardSection({ report }) {
  const ranked = useMemo(() => rankEntries(report?.summary?.entries || []), [report])
  if (ranked.length < 2) return null
  const max = ranked[0]?.opsPerSec || 1

  return (
    <SectionCard icon={Gauge} eyebrow="Leaderboard" title="Ops per second" accent="emerald">
      <ol className="space-y-3">
        {ranked.map((e, i) => {
          const pct = (e.opsPerSec / max) * 100
          const color = speedColor(i, ranked.length)
          return (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-5 shrink-0">#{i + 1}</span>
                  <span className="truncate text-sm font-medium">{e.title}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0">{formatOps(e.opsPerSec)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(3, pct)}%`, background: color }}
                />
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {report?.summary?.dataSource === 'v8' ? 'V8 Firecracker analysis' : 'Aggregated browser runs'}
        {' · '}
        {ranked.length} tests
      </p>
    </SectionCard>
  )
}

function WinnerSection({ report }) {
  const leader = report?.summary?.leader
  const ranked = report?.summary?.ranked || []
  const second = ranked[1]
  if (!leader) return null
  const lead = second && second.opsPerSec > 0 ? leader.opsPerSec / second.opsPerSec : null

  return (
    <SectionCard icon={Trophy} eyebrow="Winner" title={leader.title} accent="emerald">
      <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/30 p-4">
        <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">Speed</div>
        <div className="mt-1 text-3xl font-bold text-emerald-700 dark:text-emerald-300">
          {formatOps(leader.opsPerSec)}
          <span className="ml-1.5 text-xs font-medium text-foreground/70">ops/sec</span>
        </div>
        {lead && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <Crown className="h-3.5 w-3.5 text-amber-500" />
            <span>
              <span className="font-semibold">{formatMultiplier(lead)}</span> ahead of {second.title}
            </span>
          </div>
        )}
      </div>
      <div className="mt-3">
        <MobileCode code={leader.code} />
      </div>
    </SectionCard>
  )
}

function HeadToHeadSection({ report }) {
  const leader = report?.summary?.leader
  const lagger = report?.summary?.lagger
  if (!leader || !lagger || leader === lagger) return null
  const ratio = lagger.opsPerSec > 0 ? leader.opsPerSec / lagger.opsPerSec : null

  const Tile = ({ entry, color, label, Icon }) => {
    const styles = {
      emerald: 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
      rose: 'border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
    }[color]
    return (
      <div className={`rounded-xl border-2 p-4 ${styles}`}>
        <div className="flex items-center justify-between mb-1.5">
          <Pill color={color}>{label}</Pill>
          <Icon className="h-4 w-4 opacity-70" />
        </div>
        <div className="text-base font-bold tracking-tight text-foreground">{entry.title}</div>
        <div className="mt-0.5 text-2xl font-bold">
          {formatOps(entry.opsPerSec)}
          <span className="ml-1.5 text-xs font-medium text-muted-foreground">ops/sec</span>
        </div>
        <div className="mt-3">
          <MobileCode code={entry.code} />
        </div>
      </div>
    )
  }

  return (
    <SectionCard
      icon={Zap}
      eyebrow="Head to head"
      title={ratio ? `${formatMultiplier(ratio)} difference` : 'Fastest vs slowest'}
      accent="rose"
    >
      <div className="space-y-3">
        <Tile entry={leader} color="emerald" label="Fastest" Icon={Trophy} />
        <Tile entry={lagger} color="rose" label="Slowest" Icon={Gauge} />
      </div>
    </SectionCard>
  )
}

function RuntimesSection({ report }) {
  const grouped = useMemo(() => {
    const flat = flattenRuntimes(report)
    if (!flat.length) return null
    const byTest = new Map()
    let globalMax = 0
    for (const slot of flat) {
      if (!byTest.has(slot.testIndex)) {
        byTest.set(slot.testIndex, { title: slot.testTitle, runtimes: [] })
      }
      byTest.get(slot.testIndex).runtimes.push({ runtime: slot.runtime, ops: slot.avgOpsPerSec })
      if (slot.avgOpsPerSec > globalMax) globalMax = slot.avgOpsPerSec
    }
    for (const t of byTest.values()) t.runtimes.sort((a, b) => b.ops - a.ops)
    return { tests: [...byTest.values()], max: globalMax || 1 }
  }, [report])

  if (!grouped) return null

  return (
    <SectionCard icon={Cpu} eyebrow="Runtimes" title="Across JS engines" accent="sky">
      <div className="space-y-5">
        {grouped.tests.map((test, ti) => (
          <div key={ti}>
            <div className="text-sm font-semibold mb-2 truncate">{test.title}</div>
            <div className="space-y-2">
              {test.runtimes.map(({ runtime, ops }) => {
                const pct = (ops / grouped.max) * 100
                return (
                  <div key={runtime}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="font-medium">{runtime}</span>
                      <span className="tabular-nums text-muted-foreground">{formatOps(ops)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(3, pct)}%`, background: runtimeHexColor(runtime) }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Same code, different engines. Higher = faster.
      </p>
    </SectionCard>
  )
}

function InsightSection({ report }) {
  const insight = report?.analysis?.comparison
  if (!insight) return null

  const text = typeof insight === 'string' ? insight : (insight.summary || insight.text || null)
  const tests = report?.analysis?.results || []
  const algoIdx = typeof insight === 'object' ? insight.fastestByAlgorithm : -1
  const rtIdx = typeof insight === 'object' ? insight.fastestByRuntime : -1
  const algo = algoIdx >= 0 ? tests.find(r => r.testIndex === algoIdx) : null
  const rt = rtIdx >= 0 ? tests.find(r => r.testIndex === rtIdx) : null
  const divergence = typeof insight === 'object' && insight.divergence
  const sameWinner = algo && rt && algoIdx === rtIdx

  if (!text && !algo && !rt) return null

  const intro = text || (
    divergence
      ? "The interpreter and the optimising compiler disagree on the fastest test — a hallmark of a JIT-sensitive benchmark."
      : sameWinner
        ? "The same test wins both with and without the JIT — the result is driven by genuine algorithmic differences."
        : "Comparing what the algorithm 'should' do (interpreted) against what V8's JIT actually delivers."
  )

  return (
    <SectionCard icon={Brain} eyebrow="Analyst's take" title="What the data means" accent="violet">
      <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{intro}</p>

      {sameWinner && algo && (
        <div className="mt-4 rounded-xl border-2 border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/30 p-4">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Pill color="emerald">Wins on paper</Pill>
            <Pill color="violet">Wins in production</Pill>
          </div>
          <div className="text-base font-bold">{algo.title || `Test ${algoIdx + 1}`}</div>
        </div>
      )}

      {!sameWinner && (algo || rt) && (
        <div className="mt-4 space-y-3">
          {algo && (
            <div className="rounded-xl border-2 border-violet-200 dark:border-violet-800/60 bg-violet-50 dark:bg-violet-950/30 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Pill color="violet">Best on paper</Pill>
                <span className="text-[11px] text-muted-foreground">QuickJS</span>
              </div>
              <div className="text-sm font-semibold">{algo.title || `Test ${algoIdx + 1}`}</div>
            </div>
          )}
          {rt && (
            <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Pill color="emerald">Best in production</Pill>
                <span className="text-[11px] text-muted-foreground">V8 with JIT</span>
              </div>
              <div className="text-sm font-semibold">{rt.title || `Test ${rtIdx + 1}`}</div>
            </div>
          )}
        </div>
      )}

      {divergence && algo && rt && !sameWinner && (
        <div className="mt-3 rounded-lg border-2 border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
          <span className="font-semibold">JIT-sensitive.</span>{' '}
          <span className="text-foreground/80">Re-validate before generalising.</span>
        </div>
      )}
    </SectionCard>
  )
}

function MethodologySection({ report }) {
  const agg = useMemo(() => aggregateStats(report?.stats), [report])
  const runtimeSources = useMemo(() => aggregateRuntimeSources(report), [report])
  if (agg.totalRuns <= 0 && runtimeSources.runtimes.length === 0) return null

  const runtimeLabel = (runtime) => {
    const meta = runtimePalette(runtime)
    const version = typeof runtime === 'string' && runtime.includes('@')
      ? runtime.slice(runtime.indexOf('@') + 1)
      : null
    return version ? `${meta.label} ${version}` : meta.label
  }

  const topBrowsers = agg.browsers.slice(0, 4)
  const topOSes = agg.oses.slice(0, 4)

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
  const Bars = ({ items }) => (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.name}>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-medium truncate pr-2">{item.name}</span>
            <span className="text-muted-foreground tabular-nums shrink-0">{(item.share * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(3, item.share * 100)}%`, background: colors[i % colors.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <SectionCard icon={Monitor} eyebrow="Methodology" title="Where the data came from" accent="sky">
      <div className="rounded-xl border-2 border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/30 p-4">
        <div className="text-[11px] uppercase tracking-wider text-sky-700 dark:text-sky-300 font-semibold">Browser runs</div>
        <div className="mt-0.5 text-3xl font-bold text-sky-900 dark:text-sky-100">{agg.totalRuns.toLocaleString('en')}</div>
        <p className="mt-1.5 text-xs text-foreground/75">
          Public benchmark executions used for leaderboard and environment breakdowns.
        </p>
      </div>

      {runtimeSources.runtimes.length > 0 && (
        <div className="mt-4 rounded-xl border-2 border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-4">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">Controlled runtimes</div>
          <div className="mt-0.5 text-3xl font-bold text-emerald-900 dark:text-emerald-100">
            {runtimeSources.runtimes.length} engine{runtimeSources.runtimes.length === 1 ? '' : 's'}
          </div>
          <p className="mt-1.5 text-xs text-foreground/75">
            Node / Deno / Bun worker data across {runtimeSources.totalRuntimeSlots} test-runtime pairs
            {runtimeSources.totalProfiles > 0 ? ` and ${runtimeSources.totalProfiles} resource profiles` : ''}.
          </p>
          <div className="mt-3 space-y-2">
            {runtimeSources.runtimes.map(rt => (
              <div key={rt.runtime}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: runtimeHexColor(rt.runtime) }}
                    />
                    {runtimeLabel(rt.runtime)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{formatOps(rt.avgOpsPerSec)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {rt.tests} test{rt.tests === 1 ? '' : 's'} · {rt.profiles} profile{rt.profiles === 1 ? '' : 's'}
                  {rt.hasPerfCounters ? ' · perf counters' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {topBrowsers.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Top browsers</div>
          <Bars items={topBrowsers} />
        </div>
      )}

      {topOSes.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Top operating systems</div>
          <Bars items={topOSes} />
        </div>
      )}
    </SectionCard>
  )
}

function FooterSection({ report }) {
  return (
    <section className="rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 text-white p-5">
      <h3 className="text-lg font-bold tracking-tight">Run it yourself.</h3>
      <p className="mt-1.5 text-xs text-violet-200/80">
        Every benchmark on jsperf.net is reproducible — open source, hit Run.
      </p>
      <Link
        href={`/${report.slug}${report.revision > 1 ? `/${report.revision}` : ''}`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-medium border border-white/15"
      >
        Open source benchmark
        <ExternalLink className="h-3 w-3" />
      </Link>
      <div className="mt-4 text-[11px] text-violet-300/70">
        Powered by jsperf.net · presentation reports are a donor perk.
      </div>
    </section>
  )
}

/* --------------------------------- root --------------------------------- */

export default function MobileReportViewer({
  report,
  shareUrl,
  copied,
  onCopyLink,
  onShare,
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-foreground flex flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b bg-white/85 dark:bg-slate-900/70 backdrop-blur">
        <Link href="/" className="flex items-center gap-1.5 font-semibold text-sm shrink-0">
          <Presentation className="h-4 w-4 text-violet-600" />
          <span>jsPerf</span>
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopyLink}
            disabled={!shareUrl}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Copy share link"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onShare}
            disabled={!shareUrl}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Share report"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4">
        <HeroSection report={report} />
        <LeaderboardSection report={report} />
        <WinnerSection report={report} />
        <HeadToHeadSection report={report} />
        <RuntimesSection report={report} />
        <InsightSection report={report} />
        <MethodologySection report={report} />
        <FooterSection report={report} />
      </main>
    </div>
  )
}
