import Link from 'next/link'
import Layout from './Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, BarChart3, BookOpen, CheckCircle2, Code2, Cpu, Gauge, GitBranch, Layers3, Share2, Sparkles } from 'lucide-react'

const highlightIcons = [Gauge, Code2, Share2]
const sectionIcons = [Cpu, GitBranch, Layers3, BookOpen]

function BenchmarkPreview({ title }) {
  const compactTitle = title.replace(/ Online$/, '')

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-3xl bg-primary/10 blur-3xl" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-background/90 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          </div>
          <span className="font-mono text-xs text-muted-foreground">jsperf.net/run</span>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Benchmark suite</div>
            <h2 className="mt-2 line-clamp-2 text-xl font-bold tracking-tight">{compactTitle}</h2>
          </div>

          <div className="grid gap-3">
            {[
              ['test A', '8.42M ops/sec', 'w-11/12', 'bg-primary'],
              ['test B', '6.18M ops/sec', 'w-8/12', 'bg-blue-500'],
              ['test C', '4.91M ops/sec', 'w-6/12', 'bg-violet-500'],
            ].map(([label, value, width, color]) => (
              <div key={label} className="rounded-xl border border-border bg-card/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{label}</span>
                  <span className="font-mono text-xs font-semibold">{value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${width} ${color}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['Browser', 'ops/sec'],
              ['V8', 'JIT'],
              ['QuickJS', 'baseline'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="mt-1 text-sm font-bold">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SEOLandingPage({
  badge,
  title,
  description,
  primaryCta = { href: '/create', label: 'Create a benchmark' },
  secondaryCta = { href: '/latest', label: 'Browse latest benchmarks' },
  highlights = [],
  sections = [],
  faqs = [],
  relatedLinks = [],
}) {
  return (
    <Layout>
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-border bg-card/60 px-5 py-10 shadow-sm sm:px-8 lg:px-12 lg:py-14">
        <div className="absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-24 -left-24 -z-10 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" aria-hidden="true" />
        <div className="grid items-center gap-10 lg:grid-cols-[1.08fr,0.92fr]">
          <div>
            {badge && (
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-sm font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {badge}
              </div>
            )}
            <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{description}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-6 shadow-lg shadow-primary/20">
                <Link href={primaryCta.href}>
                  {primaryCta.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {secondaryCta && (
                <Button asChild variant="outline" size="lg" className="rounded-full bg-background/70 px-6">
                  <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
                </Button>
              )}
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                ['Browser', 'runs'],
                ['Runtime', 'signals'],
                ['Share', 'URL'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="text-xl font-bold tracking-tight">{value}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <BenchmarkPreview title={title} />
        </div>
      </section>

      {highlights.length > 0 && (
        <section className="relative -mt-4 grid gap-4 px-1 pb-12 md:grid-cols-3">
          {highlights.map((item, index) => {
            const Icon = highlightIcons[index % highlightIcons.length]

            return (
            <Card key={item.title} className="group border-border bg-background/95 shadow-lg shadow-black/5 transition-all hover:-translate-y-1 hover:border-primary/40">
              <CardHeader className="p-5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{item.title}</CardTitle>
                <CardDescription className="text-sm leading-6">{item.description}</CardDescription>
              </CardHeader>
            </Card>
          )})}
        </section>
      )}

      {sections.length > 0 && (
        <section className="space-y-10 border-t border-border py-14">
          {sections.map((section, index) => {
            const Icon = sectionIcons[index % sectionIcons.length]

            return (
            <div key={section.title} className="grid gap-6 rounded-3xl border border-border bg-card/35 p-5 md:grid-cols-[0.8fr,1.2fr] md:p-7">
              <div className="md:pr-4">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{section.title}</h2>
                {section.description && (
                  <p className="mt-3 text-muted-foreground leading-7">{section.description}</p>
                )}
              </div>
              <div className="grid gap-3">
                {section.points.map((point) => (
                  <div key={point} className="flex gap-3 rounded-2xl border border-border bg-background/70 p-4">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <p className="text-sm leading-6">{point}</p>
                  </div>
                ))}
              </div>
            </div>
          )})}
        </section>
      )}

      {faqs.length > 0 && (
        <section className="border-t border-border py-14">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                <BarChart3 className="h-4 w-4" />
                Benchmark clarity
              </div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Frequently asked questions</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Short answers for searchers, with enough context to help them create a better benchmark.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {faqs.map((faq) => (
              <Card key={faq.question} className="border-border bg-card/60">
                <CardHeader className="p-5 pb-2">
                  <CardTitle className="text-base">{faq.question}</CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <p className="text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {relatedLinks.length > 0 && (
        <section className="border-t border-border py-14">
          <div className="overflow-hidden rounded-3xl border border-border bg-card/50">
            <div className="grid gap-0 lg:grid-cols-[0.75fr,1.25fr]">
              <div className="border-b border-border bg-muted/30 p-6 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <BookOpen className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Related benchmark resources</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Keep moving through the JavaScript benchmark cluster with pages that target adjacent search intent.
                </p>
              </div>
              <div className="grid md:grid-cols-2">
                {relatedLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="group border-b border-border p-5 transition-colors hover:bg-muted/40 md:border-r md:[&:nth-child(2n)]:border-r-0">
                    <h3 className="font-semibold group-hover:text-primary">{link.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{link.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </Layout>
  )
}
