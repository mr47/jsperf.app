import { Code2, Gauge, Share2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Step = { icon: LucideIcon; title: string; body: string }

const STEPS: Step[] = [
  {
    icon: Code2,
    title: 'Write',
    body: 'Add shared setup, then two or more snippets. Plain JavaScript or TypeScript with types, generics and unions — no rewriting first.',
  },
  {
    icon: Gauge,
    title: 'Run',
    body: 'Each case runs in a sandboxed iframe on tinybench. You get ops/sec, margin of error and a ranked result in a few seconds.',
  },
  {
    icon: Share2,
    title: 'Share',
    body: 'Every benchmark has a stable URL and revision history. Runs from other browsers and devices roll up into per-benchmark stats.',
  },
]

const RUNTIMES = ['Browser', 'QuickJS', 'V8', 'Node', 'Deno', 'Bun']

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="relative z-10 border-t border-border/60 py-16 sm:py-20">
      {/* This section sits over the densest part of the animated backdrop, so
          everything rests on a translucent panel to keep the copy readable. */}
      <div className="rounded-3xl border border-border/70 bg-background/85 p-6 shadow-sm backdrop-blur-md sm:p-10 lg:p-12">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="how-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">Write, run, share</h2>
          <p className="mt-3 text-lg text-muted-foreground">
            The jsPerf workflow you remember, rebuilt on a modern runner with accurate timing.
          </p>
        </div>

        <ol className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">0{index + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">Then take the same code to every runtime that matters</p>
          <ul className="flex flex-wrap justify-center gap-2">
            {RUNTIMES.map((runtime) => (
              <li key={runtime} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">{runtime}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
