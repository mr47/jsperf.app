import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { benchmarkPath } from '../../lib/benchmark/paths'
import type { HomeLatestBenchmark } from '../../lib/homeShared'

// Fixed timezone so the statically rendered markup matches on hydration.
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function publishedDate(iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : dateFormatter.format(time)
}

export default function LatestBenchmarks({ items }: { items: HomeLatestBenchmark[] }) {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="latest-heading" className="border-t border-border/60 py-16 sm:py-20">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="latest-heading" className="text-3xl font-bold tracking-tight">Latest benchmarks</h2>
          <p className="mt-2 text-muted-foreground">Fresh public suites from the community. Open one and press Run.</p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/latest">
            Browse all
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.slug}>
            <Link
              href={benchmarkPath(item.slug, item.revision)}
              className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-foreground/30 hover:no-underline"
            >
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className={`rounded-full border px-2 py-0.5 font-medium ${item.language === 'typescript' ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-border bg-muted/50'}`}>
                  {item.language === 'typescript' ? 'TypeScript' : 'JavaScript'}
                </span>
                <time dateTime={item.published}>{publishedDate(item.published)}</time>
              </div>
              <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-foreground group-hover:underline">{item.title}</h3>
              <p className="mt-auto pt-4 text-xs text-muted-foreground">
                {item.testsCount} case{item.testsCount === 1 ? '' : 's'}
                {item.revisionCount > 1 && <> · {item.revisionCount} revisions</>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
