import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function Hero() {
  return (
    <section className="relative pb-10 pt-16 sm:pb-14 sm:pt-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
          A modern, open-source rewrite of jsPerf
        </span>

        <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
          Benchmark JavaScript
          <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-violet-400">
            {' '}in your browser
          </span>
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Compare snippets by ops/sec, share a link, and go deeper with server-side analysis across V8, QuickJS, Node, Deno and Bun.
        </p>

        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full px-7 text-base font-semibold shadow-md">
            <Link href="/create">
              Create a benchmark
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 rounded-full bg-background/70 px-7 text-base font-semibold backdrop-blur">
            <Link href="/latest">Browse latest</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
