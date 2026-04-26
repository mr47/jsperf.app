// @ts-nocheck
import SEO from '../../components/SEO'
import SEOLandingPage from '../../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../../lib/seo'

const path = '/benchmarks/foreach-vs-for-loop'
const title = 'forEach vs for Loop JavaScript Performance Benchmark'
const description =
  'Benchmark JavaScript forEach versus for loops online with realistic data, shareable jsPerf results, and browser plus runtime performance analysis.'

const faqs = [
  {
    question: 'Is forEach slower than a for loop in JavaScript?',
    answer:
      'It often can be slower for hot array loops because each iteration goes through a callback, but the real answer depends on the workload, runtime, input size, and surrounding code.',
  },
  {
    question: 'Should I always replace forEach with for loops?',
    answer:
      'No. Use readable code by default. Consider a for loop when the measured difference matters for a real performance-sensitive path.',
  },
  {
    question: 'How should I benchmark forEach vs for?',
    answer:
      'Use the same input array, put data generation in setup, make both test cases perform equivalent work, and rerun the benchmark in the environments you care about.',
  },
  {
    question: 'Can jsPerf compare array iteration across runtimes?',
    answer:
      'Yes. Browser results are available directly, and Deep Analysis plus the optional worker can add QuickJS, V8, Node, Deno, and Bun signals.',
  },
]

export default function ForEachVsForLoopBenchmark() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'foreach vs for loop performance',
          'javascript foreach vs for',
          'for loop vs foreach javascript benchmark',
          'fastest javascript loop',
          'array loop performance javascript',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Benchmarks', path },
            { name: 'forEach vs for Loop', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="Benchmark topic"
        title={title}
        description={description}
        primaryCta={{ href: '/create', label: 'Create this benchmark' }}
        secondaryCta={{ href: '/latest', label: 'Browse iteration benchmarks' }}
        highlights={[
          {
            title: 'Common performance question',
            description: 'Array iteration is one of the most searched JavaScript benchmark topics.',
          },
          {
            title: 'Workload-sensitive answer',
            description: 'The fastest loop can change with input size, callback work, runtime, and optimization state.',
          },
          {
            title: 'Best answered by rerunning',
            description: 'A saved jsPerf page lets you rerun the comparison as browsers and runtimes change.',
          },
        ]}
        sections={[
          {
            title: 'What to include in the test',
            description: 'A fair iteration benchmark compares equivalent work.',
            points: [
              'Generate the array in setup so allocation does not dominate every test case.',
              'Have both implementations produce the same result so dead-code elimination is less likely to distort the result.',
              'Try small, medium, and large input sizes if your production workload varies.',
            ],
          },
          {
            title: 'What to avoid',
            description: 'Iteration benchmarks are easy to make misleading.',
            points: [
              'Do not compare a loop that does less work with a callback that does more work.',
              'Do not generalize one browser result to every runtime and hardware profile.',
              'Do not trade away readability unless the benchmark maps to a real hot path.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
