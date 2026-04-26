// @ts-nocheck
import SEO from '../../components/SEO'
import SEOLandingPage from '../../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../../lib/seo'

const path = '/alternatives/jsbench'
const title = 'JSBench Alternative for JavaScript Benchmarks'
const description =
  'Looking for a JSBench alternative? Use jsPerf to create shareable JavaScript and TypeScript benchmarks with browser results, revisions, and deeper runtime analysis.'

const faqs = [
  {
    question: 'Is jsPerf an alternative to JSBench?',
    answer:
      'Yes. jsPerf is an online JavaScript benchmark tool for creating, running, saving, and sharing benchmark pages. It also supports TypeScript and deeper runtime analysis.',
  },
  {
    question: 'What is the difference between jsPerf and a simple benchmark playground?',
    answer:
      'jsPerf focuses on saved benchmark pages, revisions, browser results, and optional deeper analysis from QuickJS, V8, Node, Deno, and Bun.',
  },
  {
    question: 'Can I migrate an old benchmark idea to jsPerf?',
    answer:
      'Yes. Create a new benchmark page, move shared data into setup, add each approach as a test case, and save the page as a shareable URL.',
  },
  {
    question: 'Does jsPerf support TypeScript benchmarks?',
    answer:
      'Yes. jsPerf supports JavaScript and TypeScript benchmark snippets, including typed setup and test bodies.',
  },
]

export default function JsbenchAlternative() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'jsbench alternative',
          'jsbench.me alternative',
          'jsperf alternative',
          'javascript benchmark alternative',
          'benchmark.js alternative online',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          faqPageSchema(faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Alternatives', path },
            { name: 'JSBench Alternative', path },
          ]),
        ]}
      />
      <SEOLandingPage
        badge="Benchmark tool comparison"
        title={title}
        description={description}
        primaryCta={{ href: '/create', label: 'Create a jsPerf benchmark' }}
        secondaryCta={{ href: '/latest', label: 'See public benchmarks' }}
        highlights={[
          {
            title: 'Shareable benchmark pages',
            description: 'Save benchmarks as stable URLs with revisions instead of treating results as disposable scratchpad state.',
          },
          {
            title: 'JavaScript and TypeScript',
            description: 'Write modern typed snippets, keep source readable, and run prepared JavaScript where engines require it.',
          },
          {
            title: 'Beyond browser-only results',
            description: 'Use Deep Analysis and the optional worker path for QuickJS, V8, Node, Deno, and Bun context.',
          },
        ]}
        sections={[
          {
            title: 'When jsPerf is a good fit',
            description: 'Use jsPerf when a benchmark should be easy to revisit, share, and explain.',
            points: [
              'You want stable URLs for team discussions, issues, pull requests, or docs.',
              'You need benchmark revisions as the code or methodology changes.',
              'You want runtime context beyond one browser execution environment.',
            ],
          },
          {
            title: 'How to start',
            description: 'A good migration keeps the benchmark focused.',
            points: [
              'Copy the setup data into preparation or setup code.',
              'Add each competing implementation as a separate test case.',
              'Save the benchmark and link teammates to the canonical jsPerf URL.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
