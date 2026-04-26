// @ts-nocheck
import SEO from '../components/SEO'
import SEOLandingPage from '../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../lib/seo'

const path = '/typescript-benchmark'
const title = 'TypeScript Benchmark Tool Online'
const description =
  'Benchmark TypeScript code online with typed setup, generic helpers, browser results, and cross-runtime analysis for JavaScript, V8, QuickJS, Node, Deno, and Bun.'

const faqs = [
  {
    question: 'Can I benchmark TypeScript code without converting it to JavaScript first?',
    answer:
      'Yes. jsPerf keeps the original TypeScript source for editing and sharing, then prepares the right runtime form for each benchmark engine.',
  },
  {
    question: 'Do browsers run TypeScript directly?',
    answer:
      'Browsers run compiled JavaScript. jsPerf compiles TypeScript where needed while keeping the typed source visible in the benchmark page.',
  },
  {
    question: 'Can Deno and Bun run TypeScript benchmarks natively?',
    answer:
      'When the optional multi-runtime worker is configured, Deno and Bun can run TypeScript-oriented benchmarks in their own runtime environment.',
  },
  {
    question: 'What TypeScript features can I use in a benchmark?',
    answer:
      'You can benchmark typed setup data, interfaces, generics, discriminated unions, type annotations, and real helper functions from your application code.',
  },
]

export default function TypeScriptBenchmark() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'typescript benchmark',
          'benchmark typescript code online',
          'typescript performance test',
          'typescript benchmark tool',
          'benchmark typed javascript',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'TypeScript Benchmark', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="TypeScript benchmarks"
        title={title}
        description={description}
        primaryCta={{ href: '/create', label: 'Create a TypeScript benchmark' }}
        secondaryCta={{ href: '/yepawu', label: 'Open a TypeScript example' }}
        highlights={[
          {
            title: 'Typed source preserved',
            description: 'Keep TypeScript in setup, teardown, and test bodies so shared benchmarks stay readable.',
          },
          {
            title: 'Runtime-aware preparation',
            description: 'Compile where JavaScript is required and keep native TypeScript paths available where supported.',
          },
          {
            title: 'Real workload support',
            description: 'Use typed arrays, generics, event unions, object shapes, and helpers that resemble production code.',
          },
        ]}
        sections={[
          {
            title: 'Why TypeScript changes benchmark workflows',
            description: 'Many teams optimize typed code, not plain snippets copied into a scratchpad.',
            points: [
              'Benchmark generic helpers, typed transformations, parsing functions, and data-shape decisions without stripping annotations first.',
              'Keep the source page useful for review because teammates can see the original TypeScript intent.',
              'Compare compiled browser behavior with deeper runtime signals from V8, QuickJS, Node, Deno, and Bun.',
            ],
          },
          {
            title: 'Good TypeScript benchmark candidates',
            description: 'Use benchmarks for code paths where type-driven structure affects the implementation.',
            points: [
              'Discriminated-union routers and event dispatch helpers.',
              'Generic indexing, grouping, mapping, and filtering functions.',
              'Serialization, validation, cloning, parsing, and formatting helpers.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
