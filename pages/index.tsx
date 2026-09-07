import type { GetStaticProps } from 'next'
import dynamic from 'next/dynamic'

import SEO from '../components/SEO'
import Layout from '../components/Layout'
import Hero from '../components/home/Hero'
import LiveDemo from '../components/home/LiveDemo'
import HowItWorks from '../components/home/HowItWorks'
import DeepAnalysisShowcase from '../components/home/DeepAnalysisShowcase'
import LatestBenchmarks from '../components/home/LatestBenchmarks'
import Guides from '../components/home/Guides'
import Support from '../components/home/Support'
import { loadHomeData } from '../lib/home'
import type { HomeData } from '../lib/homeShared'
import { softwareApplicationSchema, websiteSchema } from '../lib/seo'

type Props = HomeData

// Animated 3D ASCII backdrop; sits behind the whole page like it always has.
const HeroBackground = dynamic(() => import('../components/HeroBackground'), { ssr: false })

export default function Home({ stats, latest, demo }: Props) {
  return (
    <>
      <SEO
        title="Online JavaScript and TypeScript Benchmark Tool"
        description="Run JavaScript and TypeScript benchmarks online. Compare code snippets by ops/sec, save shareable jsPerf tests, and analyze browser, V8, QuickJS, Node, Deno, Bun, and Node JIT behavior."
        canonical="/"
        ogImage="/og-image.png"
        keywords={[
          'js benchmark',
          'javascript benchmark online',
          'online javascript performance benchmark',
          'typescript benchmark online',
          'compare javascript snippets',
        ]}
        jsonLd={[softwareApplicationSchema(), websiteSchema()]}
      />
      <Layout wide>
        <HeroBackground />
        <Hero />
        <LiveDemo demo={demo} stats={stats} />
        <HowItWorks />
        <DeepAnalysisShowcase />
        <LatestBenchmarks items={latest} />
        <Guides />
        <Support />
      </Layout>
    </>
  )
}

const EMPTY: HomeData = {
  stats: { benchmarks: 0, testCases: 0, runs: 0, analyses: 0, reports: 0 },
  latest: [],
  demo: null,
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  let data = EMPTY
  try {
    data = await loadHomeData()
  } catch (error) {
    // The home page must still build when the database is unreachable;
    // sections that depend on live data hide themselves.
    console.error('[home] failed to load data', error)
  }

  return {
    props: JSON.parse(JSON.stringify(data)),
    revalidate: 60 * 60,
  }
}
