import Head from 'next/head'
import Layout from '../components/Layout'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Zap, Share2, Code2, Sparkles, TrendingUp, Users } from 'lucide-react'
import GitHubIcon from '../components/GitHubIcon'
import dynamic from 'next/dynamic'

const HeroBackground = dynamic(() => import('../components/HeroBackground'), { ssr: false })

export default function Home(props) {
  return (
    <>
      <Head>
        <title>jsPerf - Online JavaScript performance benchmark</title>
        <meta
          name="description"
          content="jsPerf.net is an online JavaScript performance benchmark test runner"
          key="desc"
        />
        <link href="https://jsperf.net" rel="canonical" />
      </Head>
      <Layout>
        {/* Animated 3D ASCII Background */}
        <HeroBackground />
        
        {/* Decorative Background Elements */}
        <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80" aria-hidden="true">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" style={{clipPath: "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)"}}></div>
        </div>

        {/* Hero Section */}
        <section className="relative py-24 sm:py-32 flex flex-col items-center justify-center text-center space-y-10">
          <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-sm font-medium">
            <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">The spiritual successor to jsperf.com</span>
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
                  <a href="https://github.com/rd13/jsperf.app" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4" />
                    Contribute on GitHub
                  </a>
                </Button>
              </CardContent>
            </Card>
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
