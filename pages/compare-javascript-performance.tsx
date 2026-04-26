// @ts-nocheck
import SEO from '../components/SEO'
import SEOLandingPage from '../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../lib/seo'

const path = '/compare-javascript-performance'
const title = 'Compare JavaScript Function Performance Online'
const description =
  'Compare JavaScript functions and code snippets online with browser ops/sec results, shareable jsPerf URLs, and deeper QuickJS, V8, Node, Deno, and Bun analysis.'

const faqs = [
  {
    question: 'How do I compare JavaScript function performance online?',
    answer:
      'Create a jsPerf benchmark with shared setup code, add each function as a separate test case, run it in the browser, then save the result as a shareable benchmark URL.',
  },
  {
    question: 'What does ops/sec mean in a JavaScript benchmark?',
    answer:
      'Ops/sec means operations per second. Higher values usually indicate that a snippet completed more iterations within the benchmark window, but results should be interpreted with the benchmark setup and runtime in mind.',
  },
  {
    question: 'Are browser benchmarks enough for performance decisions?',
    answer:
      'Browser benchmarks are useful for frontend behavior. jsPerf also adds server-side QuickJS, V8, Node, Deno, and Bun analysis so you can compare browser results with controlled runtime signals.',
  },
  {
    question: 'Can I share JavaScript performance comparisons with my team?',
    answer:
      'Yes. Saved jsPerf benchmarks have stable URLs, revisions, latest runs, and optional presentation reports for walking teammates through benchmark results.',
  },
]

export default function CompareJavaScriptPerformance() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'compare javascript performance',
          'compare javascript function performance',
          'compare js snippets speed',
          'javascript performance comparison',
          'ops/sec javascript',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Compare JavaScript Performance', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="JavaScript performance comparison"
        title={title}
        description={description}
        highlights={[
          {
            title: 'Side-by-side snippets',
            description: 'Add multiple JavaScript test cases and compare them under the same setup and teardown code.',
          },
          {
            title: 'Browser ops/sec results',
            description: 'Run benchmarks where frontend code actually executes and inspect relative speed in the browser.',
          },
          {
            title: 'Shareable revisions',
            description: 'Save each benchmark as a stable URL with revisions so teams can revisit and rerun results.',
          },
        ]}
        sections={[
          {
            title: 'What to benchmark',
            description: 'The best comparisons isolate one decision at a time.',
            points: [
              'Compare alternative implementations of the same function, not different workloads.',
              'Move shared data generation into setup so it does not pollute the measured operation.',
              'Use teardown when each test mutates shared state and needs cleanup before the next run.',
            ],
          },
          {
            title: 'What jsPerf adds',
            description: 'A quick browser run is only one part of the performance picture.',
            points: [
              'Deep Analysis can add deterministic QuickJS baselines and canonical V8 JIT profiling.',
              'Optional worker runs compare Node.js, Deno, and Bun for runtime-sensitive code.',
              'Presentation reports turn benchmark results into a shareable explanation for teammates.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
