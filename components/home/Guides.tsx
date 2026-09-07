import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { SEO_LANDING_PAGES } from '../../lib/seo-pages'

export default function Guides() {
  return (
    <section aria-labelledby="guides-heading" className="border-t border-border/60 py-16 sm:py-20">
      <div className="mb-8 max-w-2xl">
        <h2 id="guides-heading" className="text-3xl font-bold tracking-tight">Guides and starting points</h2>
        <p className="mt-2 text-muted-foreground">Focused examples and measurement guides for when you want a starting point instead of a blank benchmark.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SEO_LANDING_PAGES.map((page) => (
          <li key={page.href}>
            <Link href={page.href} className="group flex h-full items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/30 hover:no-underline">
              <span>
                <span className="block text-sm font-semibold text-foreground group-hover:underline">{page.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{page.description}</span>
              </span>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
