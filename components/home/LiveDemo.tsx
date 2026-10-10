import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowRight, Flame, Gauge, Layers, Lock, Microscope, Play, Presentation, Rocket, Sparkles, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { benchmarkPath } from '../../lib/benchmark/paths'
import { HOME_EXAMPLE_JIT_PATH, HOME_EXAMPLE_REPORT_PATH, type HomeDemoBenchmark } from '../../lib/homeShared'

// The runner pulls in the sandbox broker, charts and deep-analysis UI; keep
// it out of the home page's initial bundle and render a placeholder first.
const TestRunner = dynamic(() => import('../TestRunner'), {
  ssr: false,
  loading: () => (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  ),
})

type Props = { demo: HomeDemoBenchmark | null }

/**
 * What the compact demo runner leaves out. Free items deep-link to where the
 * feature lives; donor items open the donor modal (mounted in the header by
 * DonorBoost, which listens for `jsperf:open-donor-modal`). Gating mirrors
 * RuntimeAnalysisModal / TestRunner: runtime choice, CPU profiles and JIT
 * capture are free; the priority lane, compatibility matrix, reports and
 * higher quotas are donor perks.
 */
type FeaturePreview = {
  icon: LucideIcon
  title: string
  body: string
  tier: 'free' | 'donor'
  href?: string
}

const FEATURE_PREVIEWS: FeaturePreview[] = [
  {
    icon: Microscope,
    title: 'Deep Analysis',
    body: 'QuickJS baseline next to V8 in a Firecracker microVM, with JIT amplification per case.',
    tier: 'free',
    href: '#deep-analysis',
  },
  {
    icon: Layers,
    title: 'Node · Deno · Bun',
    body: 'The same cases across server runtimes, at the versions you pick.',
    tier: 'free',
    href: '/javascript-runtime-benchmark',
  },
  {
    icon: Flame,
    title: 'JIT output & CPU profiles',
    body: 'Source-linked V8 optimised code and a downloadable .cpuprofile from the Node run.',
    tier: 'free',
    href: HOME_EXAMPLE_JIT_PATH,
  },
  {
    icon: Sparkles,
    title: 'Ask AI about the results',
    body: 'Hand the numbers, and the Deep Analysis when you have one, to Claude or ChatGPT in one click.',
    tier: 'free',
  },
  {
    icon: Zap,
    title: 'Priority worker lane',
    body: 'QuickJS, complexity and runtime phases skip the public app path; analyses can run for up to 10 minutes.',
    tier: 'donor',
  },
  {
    icon: Gauge,
    title: 'Compatibility matrix',
    body: 'Browser, runtime, QuickJS and V8 rankings side by side, frozen into your reports.',
    tier: 'donor',
  },
  {
    icon: Presentation,
    title: 'Presentation reports',
    body: 'Turn an analysed run into a slide deck with a shareable URL and PDF export.',
    tier: 'donor',
    href: HOME_EXAMPLE_REPORT_PATH,
  },
  {
    icon: Rocket,
    title: 'Higher limits & Boosted badge',
    body: '60 saves a minute, 10 deep analyses per 5 minutes, and a badge on your benchmarks.',
    tier: 'donor',
  },
]

function openDonorModal() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('jsperf:open-donor-modal'))
}

function TierBadge({ tier }: { tier: FeaturePreview['tier'] }) {
  if (tier === 'donor') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Lock className="h-2.5 w-2.5" aria-hidden="true" />
        Donors
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
      Free
    </span>
  )
}

function FeatureCard({ feature }: { feature: FeaturePreview }) {
  const { icon: Icon, title, body, tier, href } = feature
  const isDonor = tier === 'donor'
  const className = [
    'group flex h-full flex-col rounded-xl border p-4 text-left transition-colors',
    isDonor
      ? 'border-amber-400/30 bg-amber-500/[0.04] hover:border-amber-400/60 hover:bg-amber-500/[0.08]'
      : 'border-border bg-card hover:border-foreground/30 hover:bg-muted/40',
  ].join(' ')

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isDonor ? 'border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-300' : 'border-border bg-background text-foreground'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <TierBadge tier={tier} />
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-snug">{title}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <span className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${isDonor ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground group-hover:text-foreground'}`}>
        {isDonor ? (href ? 'See an example' : 'Unlock with a donation') : href ? 'Learn more' : 'On every benchmark page'}
        {(href || isDonor) && <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
      </span>
    </>
  )

  if (href) {
    return <Link href={href} className={className}>{content}</Link>
  }
  if (isDonor) {
    return <button type="button" onClick={openDonorModal} className={className}>{content}</button>
  }
  return <div className={className}>{content}</div>
}

export default function LiveDemo({ demo }: Props) {
  const fullBenchmarkHref = demo ? benchmarkPath(demo.slug, demo.revision) : '/latest'

  return (
    <section aria-labelledby="live-demo-heading" className="pb-16 sm:pb-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Try it</p>
            <h2 id="live-demo-heading" className="mt-1 text-lg font-semibold tracking-tight">
              {demo ? demo.title : 'A real benchmark, running here'}
            </h2>
          </div>
          {demo && (
            <Link href={benchmarkPath(demo.slug, demo.revision)} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              Open the full benchmark
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        {demo ? (
          <TestRunner
            id={demo.id}
            slug={demo.slug}
            revision={demo.revision}
            tests={demo.tests}
            setup={demo.setup}
            teardown={demo.teardown}
            language={demo.language}
            languageOptions={demo.languageOptions}
            compact
            compactTitle="Live demo"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
            <Play className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Pick any benchmark from the latest feed and press Run to see it in action.</p>
            <Link href="/latest" className="text-sm font-medium underline underline-offset-4">Browse latest benchmarks</Link>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          Runs in a sandboxed iframe on your machine. Results vary by browser and device; each full run contributes to the benchmark's cross-browser stats.
        </p>

        <div className="mt-8 border-t border-border/60 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beyond the browser run</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The full benchmark page adds server-side analysis for everyone; donors unlock the priority lane and reporting.
              </p>
            </div>
            <Link href={fullBenchmarkHref} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              {demo ? 'Try them on the full benchmark' : 'Try them on any benchmark'}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURE_PREVIEWS.map((feature) => (
              <li key={feature.title} className="min-w-0">
                <FeatureCard feature={feature} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
