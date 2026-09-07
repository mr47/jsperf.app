import { Check, Coffee, Heart } from 'lucide-react'

import { Button } from '@/components/ui/button'
import GitHubIcon from '../GitHubIcon'

const PERKS = [
  'Higher rate limits for saves and analyses',
  'Boosted badge on your benchmarks',
  'Benchmark Doctor guidance on flawed cases',
  'Shareable presentation reports with complexity slides',
]

export default function Support() {
  const openDonorModal = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('jsperf:open-donor-modal'))
  }

  return (
    <section aria-labelledby="support-heading" className="border-t border-border/60 py-16 sm:py-20">
      <div className="grid gap-10 rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="space-y-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10">
            <Heart className="h-5 w-5 text-rose-500" fill="currentColor" aria-hidden="true" />
          </span>
          <h2 id="support-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">Keep jsPerf free, fast and ad-free</h2>
          <p className="leading-relaxed text-muted-foreground">
            Deep Analysis runs on real microVMs and multi-runtime workers, and that costs money every month. If jsPerf saves you time, consider supporting it — the site has no ads and no tracking.
          </p>
          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <Button asChild size="lg" className="rounded-full bg-rose-500 px-6 text-white hover:bg-rose-600">
              <a href="https://donatello.to/mr47" target="_blank" rel="noreferrer">
                <Coffee className="h-4 w-4" aria-hidden="true" />
                Buy me a coffee
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-6">
              <a href="https://github.com/mr47/jsperf.app" target="_blank" rel="noreferrer">
                <GitHubIcon width={16} height={16} className="fill-current" />
                Star on GitHub
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Already donated?{' '}
            <button type="button" onClick={openDonorModal} className="underline underline-offset-2 hover:text-foreground">
              Link your Donatello name
            </button>{' '}
            to claim your boost.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm font-semibold">Donors get</p>
          <ul className="mt-3 space-y-2.5 text-sm">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
