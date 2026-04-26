// @ts-nocheck
import SEO from '../components/SEO'
import SEOLandingPage from '../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../lib/seo'

const path = '/javascript-runtime-benchmark'
const title = 'JavaScript Runtime Benchmark: Node vs Deno vs Bun'
const description =
  'Compare JavaScript runtime performance across browser, Node.js, Deno, Bun, V8, and QuickJS with shareable jsPerf benchmark pages and deep analysis.'

const faqs = [
  {
    question: 'Can jsPerf compare Node.js, Deno, and Bun performance?',
    answer:
      'Yes. When the optional benchmark worker is configured, jsPerf can run snippets in Node.js, Deno, and Bun and show runtime comparison results alongside browser benchmarks.',
  },
  {
    question: 'Why compare JavaScript runtimes?',
    answer:
      'Runtime behavior can differ because engines, JIT warmup, native APIs, module handling, and memory behavior are not identical across Node.js, Deno, Bun, browsers, and QuickJS.',
  },
  {
    question: 'Is V8 the same as Node.js performance?',
    answer:
      'Not exactly. Node.js uses V8, but Node adds runtime APIs, event loop behavior, and process-level characteristics. jsPerf separates canonical V8 analysis from runtime worker results.',
  },
  {
    question: 'Should I trust one runtime benchmark forever?',
    answer:
      'No. Runtime versions change quickly. Treat a benchmark as evidence for a specific snippet, environment, and version, then rerun it when engines or code change.',
  },
]

export default function JavaScriptRuntimeBenchmark() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'javascript runtime benchmark',
          'node vs bun benchmark',
          'deno vs node benchmark',
          'node deno bun performance',
          'v8 benchmark javascript',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'JavaScript Runtime Benchmark', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="Runtime performance"
        title={title}
        description={description}
        primaryCta={{ href: '/create', label: 'Create a runtime benchmark' }}
        highlights={[
          {
            title: 'Node, Deno, and Bun',
            description: 'Use the optional worker path to compare server-side JavaScript runtimes.',
          },
          {
            title: 'V8 and QuickJS signals',
            description: 'Deep Analysis separates deterministic interpreter cost from canonical V8 JIT behavior.',
          },
          {
            title: 'Browser context included',
            description: 'Start with browser results, then inspect whether runtime differences change the conclusion.',
          },
        ]}
        sections={[
          {
            title: 'When runtime benchmarks matter',
            description: 'Cross-runtime comparisons are most useful when code is sensitive to engine or platform behavior.',
            points: [
              'Compare parsing, formatting, crypto-adjacent helpers, data transformations, and hot loop behavior.',
              'Check whether a Node.js optimization still wins in Deno, Bun, or browser environments.',
              'Use runtime results to guide deployment decisions only after validating the real workload shape.',
            ],
          },
          {
            title: 'How jsPerf reduces guesswork',
            description: 'The same benchmark page can collect multiple views of the same code.',
            points: [
              'Browser benchmarks show frontend behavior where user code executes.',
              'QuickJS-WASM gives a deterministic no-JIT baseline for algorithmic cost.',
              'V8 microVM and worker results add JIT and runtime-specific signals.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
