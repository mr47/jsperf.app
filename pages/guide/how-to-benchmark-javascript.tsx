// @ts-nocheck
import SEO from '../../components/SEO'
import SEOLandingPage from '../../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../../lib/seo'

const path = '/guide/how-to-benchmark-javascript'
const title = 'How to Benchmark JavaScript Correctly'
const description =
  'Learn how to benchmark JavaScript code online with useful setup data, repeatable test cases, ops/sec results, runtime context, and shareable benchmark pages.'

const faqs = [
  {
    question: 'What is a JavaScript microbenchmark?',
    answer:
      'A JavaScript microbenchmark measures a small piece of code in isolation, such as a loop, function, parser, clone operation, or data transformation.',
  },
  {
    question: 'How do I avoid misleading JavaScript benchmark results?',
    answer:
      'Keep setup outside the measured code, compare equivalent work, warm up runtimes when possible, run multiple times, and interpret browser results alongside runtime and code context.',
  },
  {
    question: 'Should I optimize based on a microbenchmark?',
    answer:
      'Use a microbenchmark as evidence, not as the whole decision. Prefer readability unless the benchmark represents a real hot path or a workload that affects users.',
  },
  {
    question: 'Why do JavaScript benchmark results change between browsers?',
    answer:
      'Different browsers and runtimes use different engines, JIT strategies, garbage collectors, timer precision, and background scheduling, so measured results can vary.',
  },
]

export default function HowToBenchmarkJavaScript() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'how to benchmark javascript',
          'javascript micro benchmark',
          'reliable javascript benchmark',
          'javascript benchmark guide',
          'benchmark javascript code',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Guides', path: '/guide/how-to-benchmark-javascript' },
            { name: 'How to Benchmark JavaScript', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="Benchmarking guide"
        title={title}
        description={description}
        primaryCta={{ href: '/create', label: 'Start a benchmark' }}
        secondaryCta={{ href: '/compare-javascript-performance', label: 'Compare snippets online' }}
        highlights={[
          {
            title: 'Measure one question',
            description: 'A useful benchmark compares equivalent implementations of the same workload.',
          },
          {
            title: 'Separate setup from work',
            description: 'Generate inputs once in setup so the measured code focuses on the operation you care about.',
          },
          {
            title: 'Interpret the result',
            description: 'Use ops/sec, runtime context, and code shape together instead of trusting a single number.',
          },
        ]}
        sections={[
          {
            title: 'Design the benchmark',
            description: 'Start by writing down the decision the benchmark should inform.',
            points: [
              'Use realistic input sizes and data shapes from your application.',
              'Put shared fixtures in preparation code or setup code, not inside every test body.',
              'Keep every test case semantically equivalent so the fastest result is solving the same problem.',
            ],
          },
          {
            title: 'Run and compare',
            description: 'A benchmark run is only useful when it is repeatable enough to discuss.',
            points: [
              'Run the same test in the browser more than once and watch for unstable winners.',
              'Use Deep Analysis for deterministic QuickJS baselines and canonical V8 behavior when browser noise is too high.',
              'Save the benchmark URL so teammates can rerun it after code, browser, or runtime versions change.',
            ],
          },
          {
            title: 'Decide responsibly',
            description: 'Performance is one input into engineering judgment.',
            points: [
              'Prefer the clearer implementation unless the measured difference matters for a real hot path.',
              'Document the environment, data shape, and conclusion when sharing results.',
              'Re-benchmark after dependency, browser, runtime, or hardware changes.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
