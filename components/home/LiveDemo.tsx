import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowRight, Play } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { benchmarkPath } from '../../lib/benchmark/paths'
import type { HomeDemoBenchmark, HomeStats } from '../../lib/homeShared'
import { formatNumber } from '../../utils/ArrayUtils'

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

type Props = { demo: HomeDemoBenchmark | null; stats: HomeStats }

const STAT_ITEMS: Array<{ key: keyof HomeStats; label: string }> = [
  { key: 'benchmarks', label: 'public benchmarks' },
  { key: 'testCases', label: 'test cases' },
  { key: 'runs', label: 'runs recorded' },
  { key: 'analyses', label: 'deep analyses' },
]

export default function LiveDemo({ demo, stats }: Props) {
  const visibleStats = STAT_ITEMS.filter(({ key }) => stats[key] > 0)

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

        {visibleStats.length > 0 && (
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/60 pt-6 sm:grid-cols-4">
            {visibleStats.map(({ key, label }) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">{formatNumber(stats[key])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
