import SEO from '../components/SEO'
import Layout from '../components/Layout'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Zap, Share2, Code2, Sparkles, TrendingUp, Users, Microscope, Cpu, BarChart3, ArrowRight, Presentation, Heart, Coffee, Rocket, Check } from 'lucide-react'
import GitHubIcon from '../components/GitHubIcon'
import dynamic from 'next/dynamic'

const HeroBackground = dynamic(() => import('../components/HeroBackground'), { ssr: false })

export default function Home(props) {
  return (
    <>
      <SEO 
        title="jsPerf - Online JavaScript performance benchmark" 
        description="jsPerf.net is an online JavaScript performance benchmark test runner" 
      />
      <Layout>
        {/* Animated 3D ASCII Background */}
        <HeroBackground />
        
        {/* Decorative Background Elements */}
        <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80" aria-hidden="true">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" style={{clipPath: "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)"}}></div>
        </div>

        {/* Hero Section */}
        <section className="relative py-24 sm:py-32 flex flex-col items-center justify-center text-center space-y-10">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-sm font-medium">
              <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">A modern full rewrite of jsPerf</span>
            </div>
            <Link
              href="#presentation-reports"
              className="group inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-colors"
            >
              <Rocket className="mr-2 h-4 w-4 text-violet-500" />
              <span>New: Shareable presentation reports</span>
              <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          
          <div className="space-y-6 max-w-4xl mx-auto px-4">
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight drop-shadow-sm">
              Benchmark JavaScript <br className="hidden sm:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600 dark:from-blue-400 dark:to-violet-400">
                Performance Instantly
              </span>
            </h1>
            <p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Write, share, and compare the execution speed of your JavaScript code snippets right in the browser.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto px-4 mt-4">
            <Button asChild size="lg" className="font-bold text-base h-14 px-8 rounded-full shadow-lg hover:shadow-xl transition-all">
              <Link href="/create">
                Create a Test Case
                <TrendingUp className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="font-bold text-base h-14 px-8 rounded-full shadow-sm hover:shadow-md transition-all">
              <Link href="/latest">
                Browse Latest
              </Link>
            </Button>
          </div>
        </section>

        {/* Stats / Social Proof (Placeholder) */}
        <section className="py-12 border-y border-border/50 bg-muted/20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div className="space-y-2">
              <h3 className="text-4xl font-bold tracking-tight text-foreground">10k+</h3>
              <p className="text-sm font-medium text-muted-foreground">Tests Created</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-4xl font-bold tracking-tight text-foreground">1M+</h3>
              <p className="text-sm font-medium text-muted-foreground">Benchmarks Run</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-4xl font-bold tracking-tight text-foreground">100%</h3>
              <p className="text-sm font-medium text-muted-foreground">Free & Open Source</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-4xl font-bold tracking-tight text-foreground">0</h3>
              <p className="text-sm font-medium text-muted-foreground">Ads or Tracking</p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24">
          <div className="text-center mb-16 space-y-4">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Everything you need to test code speed</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Built from the ground up for modern JavaScript development with a focus on speed, accuracy, and developer experience.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-yellow-500/10 flex items-center justify-center mb-4">
                  <Zap className="h-6 w-6 text-yellow-600 dark:text-yellow-500" />
                </div>
                <CardTitle className="text-xl">Lightning Fast Runner</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  Powered by a modern, secure iframe sandbox and optimized benchmark engine based on tinybench for highly accurate ops/sec calculations.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                  <Share2 className="h-6 w-6 text-green-600 dark:text-green-500" />
                </div>
                <CardTitle className="text-xl">Share & Compare</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  Easily save and share your test cases with a simple URL. Compare different approaches and browsers to find the absolute fastest solution.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                  <Code2 className="h-6 w-6 text-blue-600 dark:text-blue-500" />
                </div>
                <CardTitle className="text-xl">Modern IDE Experience</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  Enjoy syntax highlighting and code editing tailored for writing accurate benchmark setup and teardown code right in the browser.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                  <Microscope className="h-6 w-6 text-violet-600 dark:text-violet-500" />
                </div>
                <CardTitle className="text-xl">Deep Analysis Engine</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  Go beyond browser results with server-side analysis using dual engines &mdash; QuickJS-WASM for deterministic baselines and V8 Firecracker microVMs for realistic JIT profiling.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-rose-500/10 flex items-center justify-center mb-4">
                  <BarChart3 className="h-6 w-6 text-rose-600 dark:text-rose-500" />
                </div>
                <CardTitle className="text-xl">Memory Response</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  See how snippets behave under QuickJS memory-limit sweeps while V8 stays on a canonical single-core JIT run for apples-to-apples results.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors shadow-sm flex flex-col justify-between">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-foreground/5 flex items-center justify-center mb-4">
                  <GitHubIcon width={24} height={24} className="fill-foreground text-foreground" />
                </div>
                <CardTitle className="text-xl">Open Source & Free</CardTitle>
                <CardDescription className="text-base mt-2 leading-relaxed">
                  Completely free to use, ad-free, and open source. Join the community to help improve the next generation of jsPerf.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="w-full mt-4">
                  <a href="https://github.com/mr47/jsperf.app" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4" />
                    Contribute on GitHub
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Deep Analysis Spotlight */}
        <section className="py-24 border-t border-border/50">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16 space-y-4">
              <div className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/5 px-3 py-1 text-sm font-medium">
                <Microscope className="mr-2 h-4 w-4 text-violet-500" />
                <span className="text-violet-700 dark:text-violet-400">Server-Side Engine</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                Deep Performance Analysis
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Browser benchmarks vary with every run. Deep Analysis runs your code in controlled server-side environments to deliver reproducible, canonical results with predictive insights.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="relative rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Cpu className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                </div>
                <h3 className="font-semibold text-lg">QuickJS-WASM</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  A deterministic JavaScript interpreter compiled to WebAssembly. No JIT, no GC pauses, no variance &mdash; pure algorithmic cost measurement for reproducible baselines.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-xs rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2.5 py-0.5 font-medium">Deterministic</span>
                  <span className="text-xs rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2.5 py-0.5 font-medium">Reproducible</span>
                </div>
              </div>

              <div className="relative rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-blue-600 dark:text-blue-500" />
                </div>
                <h3 className="font-semibold text-lg">V8 Firecracker MicroVM</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Full V8 engine inside an isolated Firecracker microVM. Captures real JIT compilation behavior, inline caching, and garbage collection effects.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-xs rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2.5 py-0.5 font-medium">JIT Profiling</span>
                  <span className="text-xs rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2.5 py-0.5 font-medium">Isolated</span>
                </div>
              </div>

              <div className="relative rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4">
                <div className="h-10 w-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-rose-600 dark:text-rose-500" />
                </div>
                <h3 className="font-semibold text-lg">Prediction Model</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Compares interpreter memory sweeps with canonical V8 JIT results to estimate JIT amplification, memory response, and engine-specific behavior.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-xs rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-400 px-2.5 py-0.5 font-medium">Memory</span>
                  <span className="text-xs rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-400 px-2.5 py-0.5 font-medium">Prediction</span>
                </div>
              </div>
            </div>

            <div className="mt-10 text-center">
              <Button asChild variant="outline" size="lg" className="rounded-full px-8">
                <Link href="/create" className="flex items-center gap-2">
                  Try Deep Analysis
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Presentation Reports Spotlight (NEW) */}
        <section id="presentation-reports" className="py-24 border-t border-border/50">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-sm font-medium">
                  <Sparkles className="mr-2 h-4 w-4 text-violet-500" />
                  <span className="text-violet-700 dark:text-violet-400">Brand New</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Turn benchmarks into shareable <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400">presentation reports</span>
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Turn any benchmark run into a polished slide deck. Walk teammates through the methodology, the numbers, the JIT amplification, and the recommendation &mdash; on screen, in fullscreen presenter mode, or printed straight to PDF.
                </p>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                      <Check className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span><strong>Full-bleed slide viewer</strong> with keyboard navigation, fullscreen, and a mobile-optimized layout.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                      <Check className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span><strong>One immutable share URL</strong> &mdash; send it to a Slack channel, embed in a doc, or open in a meeting.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
                      <Check className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span><strong>Print-ready PDF export</strong> with light theme baked in for crisp handouts.</span>
                  </li>
                </ul>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button asChild size="lg" className="rounded-full px-6">
                    <Link href="/r/vfbvvfed" className="flex items-center gap-2">
                      <Presentation className="h-4 w-4" />
                      See an example report
                    </Link>
                  </Button>
                  <span className="inline-flex items-center text-xs text-muted-foreground">
                    <Heart className="mr-1.5 h-3.5 w-3.5 text-rose-500" />
                    Donor-supported feature
                  </span>
                </div>
              </div>

              <Link href="/r/vfbvvfed" className="group block relative focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 rounded-2xl">
                <div className="absolute -inset-4 bg-gradient-to-tr from-violet-500/20 via-fuchsia-500/10 to-blue-500/20 rounded-2xl blur-2xl transition-opacity group-hover:opacity-80" aria-hidden="true" />
                <div className="relative rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-xl overflow-hidden transition-transform group-hover:-translate-y-0.5 group-hover:shadow-2xl">
                  <div className="flex items-center gap-1.5 border-b border-border/50 px-4 py-2.5 bg-muted/40">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                    <span className="ml-3 text-xs text-muted-foreground font-mono truncate">jsperf.net/r/vfbvvfed</span>
                  </div>
                  <div className="aspect-[16/10] p-6 sm:p-8 flex flex-col bg-gradient-to-br from-slate-50 via-white to-violet-50/40 dark:from-slate-900 dark:via-slate-950 dark:to-violet-950/40">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Slide 4 of 7 &mdash; Recommendation</span>
                      <span className="text-[10px] text-muted-foreground font-mono">jsperf.net</span>
                    </div>
                    <div className="space-y-3 flex-1">
                      <h3 className="text-lg sm:text-xl font-bold tracking-tight">
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400">
                          for...of with Map.entries()
                        </span>{' '}
                        is the winner
                      </h3>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                        Outperforms <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">forEach()</code> by <strong className="text-foreground">2.3&times;</strong> under canonical V8 with stable JIT amplification.
                      </p>
                      <div className="grid grid-cols-3 gap-2 pt-3">
                        <div className="rounded-md border border-border/50 bg-card/60 p-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">QuickJS</p>
                          <p className="text-sm font-bold tabular-nums">412k <span className="text-[9px] font-normal text-muted-foreground">ops/s</span></p>
                        </div>
                        <div className="rounded-md border border-violet-500/40 bg-violet-500/5 p-2">
                          <p className="text-[9px] uppercase tracking-wider text-violet-600 dark:text-violet-400">V8</p>
                          <p className="text-sm font-bold tabular-nums">9.4M <span className="text-[9px] font-normal text-muted-foreground">ops/s</span></p>
                        </div>
                        <div className="rounded-md border border-border/50 bg-card/60 p-2">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">JIT amp.</p>
                          <p className="text-sm font-bold tabular-nums">22.8&times;</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 pt-4">
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-5 rounded-full bg-violet-500" />
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </section>

        {/* Support the Project */}
        <section className="py-24 border-t border-border/50">
          <div className="relative max-w-4xl mx-auto rounded-2xl border border-border/60 bg-gradient-to-br from-rose-500/5 via-amber-500/5 to-violet-500/5 backdrop-blur-sm p-8 sm:p-12 overflow-hidden">
            <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl" aria-hidden="true" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />

            <div className="relative grid grid-cols-1 md:grid-cols-[auto,1fr] gap-8 items-center">
              <div className="flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 bg-rose-500/30 blur-2xl rounded-full" aria-hidden="true" />
                  <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center shadow-lg">
                    <Heart className="h-10 w-10 text-white" fill="currentColor" />
                  </div>
                </div>
              </div>

              <div className="space-y-4 text-center md:text-left">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Help keep jsPerf.net free, fast, and ad-free
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Deep Analysis runs on real Firecracker microVMs and multi-runtime workers &mdash; all of it costs real money to operate. If jsPerf saves you time, please consider supporting the project. Donors get higher rate limits, a <strong className="text-foreground">Boosted</strong> badge, and access to shareable presentation reports.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center md:justify-start">
                  <Button asChild size="lg" className="rounded-full px-6 bg-rose-500 hover:bg-rose-600 text-white shadow-md hover:shadow-lg transition-all">
                    <a href="https://donatello.to/mr47" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                      <Coffee className="h-4 w-4" />
                      Buy me a coffee
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="rounded-full px-6">
                    <a href="https://github.com/mr47/jsperf.app" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                      <GitHubIcon width={16} height={16} className="fill-current" />
                      Star on GitHub
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Already donated? <button type="button" onClick={() => typeof window !== 'undefined' && window.dispatchEvent(new Event('jsperf:open-donor-modal'))} className="underline underline-offset-2 hover:text-foreground transition-colors">Link your Donatello name</button> to claim your boost.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom Decorative Element */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 transform-gpu overflow-hidden blur-3xl" aria-hidden="true">
          <div className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]" style={{clipPath: "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)"}}></div>
        </div>
      </Layout>
    </>
  )
}
