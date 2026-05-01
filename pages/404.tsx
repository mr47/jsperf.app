import Link from 'next/link'
import { ArrowRight, Bug, Code2, Home, Search, Sparkles, Terminal } from 'lucide-react'

import SEO from '../components/SEO'
import Layout from '../components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const stackTraceLines = [
  'RouteError: page is not defined',
  '  at Router.resolve("/somewhere-fast")',
  '  at TypeChecker.whisper("maybe never?")',
  '  at BenchRunner.skipWarmup()',
]

const rescueSteps = [
  {
    icon: Code2,
    title: 'Create a benchmark',
    description: 'Turn that lost tab into a JS or TS performance test.',
    href: '/create',
  },
  {
    icon: Search,
    title: 'Browse latest',
    description: 'Find a real page before the compiler files a missing-person report.',
    href: '/latest',
  },
]

export default function Custom404() {
  return (
    <>
      <SEO
        title="404: Page Not Found"
        description="This jsPerf page wandered outside the benchmark suite."
        canonical="/404"
        ogImage="/og-image.png"
        noindex={true}
      />
      <Layout>
        <section className="relative isolate flex min-h-[72vh] items-center overflow-hidden py-16 sm:py-24">
          <div className="pointer-events-none absolute inset-x-0 top-8 -z-10 transform-gpu overflow-hidden blur-3xl" aria-hidden="true">
            <div
              className="relative left-1/2 aspect-[1155/678] w-[42rem] -translate-x-1/2 bg-gradient-to-tr from-blue-500 via-violet-500 to-pink-500 opacity-20 dark:opacity-30"
              style={{
                clipPath:
                  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 72.5% 32.5%, 60.2% 62.4%, 47.5% 58.3%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 76.1% 97.7%)',
              }}
            />
          </div>

          <div className="mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
            <div className="space-y-8 text-center lg:text-left">
              <div className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-sm font-medium text-violet-700 dark:text-violet-300">
                <Bug className="mr-2 h-4 w-4" />
                HTTP 404: static analysis says this route is undefined
              </div>

              <div className="space-y-5">
                <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl">
                  This page returned{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600 dark:from-blue-400 dark:to-violet-400">
                    undefined
                  </span>
                </h1>
                <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground lg:mx-0">
                  We checked the DOM, the call stack, and one suspicious semicolon. The benchmark you wanted is not here,
                  but the runtime is still warm.
                </p>
              </div>

              <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Button asChild size="lg" className="rounded-full px-7 font-bold">
                  <Link href="/create">
                    Create a test case
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg" className="rounded-full px-7 font-bold">
                  <Link href="/">
                    <Home className="h-5 w-5" />
                    Go home
                  </Link>
                </Button>
              </div>
            </div>

            <Card className="relative overflow-hidden border-border/60 bg-card/80 shadow-2xl shadow-violet-500/10 backdrop-blur">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-pink-500" />
              <CardContent className="space-y-6 p-5 sm:p-6">
                <div className="flex items-center justify-between border-b border-border/70 pb-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Terminal className="h-4 w-4 text-violet-500" />
                    missing-page.ts
                  </div>
                  <div className="flex gap-1.5" aria-hidden="true">
                    <span className="h-3 w-3 rounded-full bg-red-400" />
                    <span className="h-3 w-3 rounded-full bg-yellow-400" />
                    <span className="h-3 w-3 rounded-full bg-green-400" />
                  </div>
                </div>

                <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/40 p-4 text-left text-sm leading-7 text-muted-foreground">
                  <code>
                    <span className="text-blue-600 dark:text-blue-400">type</span>{' '}
                    <span className="text-foreground">ExpectedPage</span> = {'{'} path: string; found: true {'}'}
                    {'\n'}
                    <span className="text-blue-600 dark:text-blue-400">const</span>{' '}
                    <span className="text-foreground">page</span>: ExpectedPage | undefined = undefined
                    {'\n\n'}
                    <span className="text-rose-600 dark:text-rose-400">throw</span>{' '}
                    <span className="text-foreground">new Error</span>(
                    <span className="text-green-700 dark:text-green-400">"404: benchmark went brrr... elsewhere"</span>)
                  </code>
                </pre>

                <div className="space-y-2 rounded-xl border border-dashed border-border bg-background/60 p-4">
                  {stackTraceLines.map((line) => (
                    <p key={line} className="font-mono text-xs text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {rescueSteps.map(({ icon: Icon, title, description, href }) => (
                    <Link
                      key={title}
                      href={href}
                      className="group rounded-xl border border-border bg-background/70 p-4 transition-colors hover:border-primary/40 hover:bg-accent hover:no-underline"
                    >
                      <Icon className="mb-3 h-5 w-5 text-violet-500" />
                      <h2 className="font-semibold text-foreground">{title}</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                    </Link>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-2 rounded-full bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                  <Sparkles className="h-4 w-4" />
                  Runtime hint: try `/create`, not `any`.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </Layout>
    </>
  )
}
