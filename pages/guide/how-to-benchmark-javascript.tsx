import SEO from '../../components/SEO'
import SEOLandingPage from '../../components/SEOLandingPage'
import { SEO_LANDING_PAGES } from '../../lib/seo-pages'
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '../../lib/seo'

const path = '/guide/how-to-benchmark-javascript'
const title = 'How to Benchmark JavaScript Correctly'
const description =
  'A practical guide to JavaScript benchmarking methodology: common measurement styles, microbenchmarks, runtime platforms, and JIT pitfalls to avoid.'

const faqs = [
  {
    question: 'What is a JavaScript microbenchmark?',
    answer:
      'A JavaScript microbenchmark measures a small operation in isolation, such as a loop, parser, clone function, serializer, regex, or data transform. It is useful for answering a narrow question, but it should not be treated as a full application performance profile.',
  },
  {
    question: 'What is the common way to measure JavaScript performance?',
    answer:
      'Most JavaScript benchmarks run each test many times, measure elapsed time with a high-resolution timer, and report throughput such as ops/sec. Good tools also warm up the code, repeat samples, and show variance instead of relying on one timing.',
  },
  {
    question: 'How do I avoid JIT-optimized benchmark results?',
    answer:
      'Avoid no-op tests, constant inputs that can be folded away, unused return values, and cases where one snippet does less work. Consume the result, vary realistic inputs, keep setup outside the timed block, and compare browser JIT results with interpreter or runtime baselines.',
  },
  {
    question: 'Should I optimize based on a microbenchmark?',
    answer:
      'Use a microbenchmark as evidence, not as the whole decision. Prefer readable code unless the benchmark represents a real hot path, a repeated server workload, or client code that users actually wait on.',
  },
  {
    question: 'Which platforms should I compare?',
    answer:
      'Start with the browser or server runtime your users actually run. jsPerf browser results are useful for quick feedback, while Deep Analysis adds QuickJS-WASM, V8 Firecracker, Node, Deno, Bun, CPU profiles, and optional Node JIT artifacts for deeper investigation.',
  },
]

export default function HowToBenchmarkJavaScript() {
  return (
    <>
      <SEO
        title={title}
        description={description}
        canonical={path}
        ogImage="/og-image.png"
        keywords={[
          'how to benchmark javascript',
          'javascript micro benchmark',
          'reliable javascript benchmark',
          'javascript benchmark guide',
          'benchmark javascript code',
          'javascript benchmark methodology',
          'avoid jit benchmark optimization',
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
            title: 'Measure a decision',
            description: 'A useful benchmark starts with one question: which implementation is better for this workload and environment?',
          },
          {
            title: 'Control the timed work',
            description: 'Put fixtures, random data, and shared helpers in setup so ops/sec reflects the operation being compared.',
          },
          {
            title: 'Check the runtime story',
            description: 'Browser, QuickJS, V8, Node, Deno, and Bun can reward different code shapes because their optimizers differ.',
          },
        ]}
        sections={[
          {
            title: 'Common measurement methods',
            description: 'JavaScript performance is usually measured as elapsed time, throughput, or profile cost.',
            points: [
              'Manual timing with performance.now() is useful for quick local checks, but it is easy to under-sample and accidentally include setup, logging, or rendering work.',
              'Benchmark harnesses such as tinybench-style runners execute each test repeatedly, collect samples, and report ops/sec so small differences are less dependent on one timer read.',
              'CPU profiles answer a different question: where time goes inside a larger flow. Use them when a microbenchmark is too isolated to explain real application behavior.',
            ],
          },
          {
            title: 'Design a fair microbenchmark',
            description: 'Microbenchmarks work best when every case does the same observable work.',
            points: [
              'Use realistic input sizes and data shapes from your application, then test more than one size if production data ranges from tiny to large.',
              'Generate fixtures in setup, keep teardown separate, and make each test return or write a result so the engine cannot treat the body as unused work.',
              'Compare equivalent algorithms. A faster snippet is only meaningful if it parses, filters, allocates, validates, or transforms the same data as the alternatives.',
            ],
          },
          {
            title: 'Use platform results carefully',
            description: 'Different platforms expose different parts of the performance picture.',
            points: [
              'Browser runs show what happens in the user agent, but they can be affected by extensions, tabs, battery mode, thermal throttling, timer precision, and background scheduling.',
              'QuickJS-WASM is a deterministic interpreter baseline. It has no browser JIT, so it helps separate algorithmic cost from optimizer behavior.',
              'V8 Firecracker, Node, Deno, and Bun runs show server-side and engine-specific behavior. Use them when code may ship outside the browser or when JIT behavior matters.',
            ],
          },
          {
            title: 'Avoid JIT benchmark traps',
            description: 'Modern engines optimize hot code aggressively, which is good in production but can mislead a small benchmark.',
            points: [
              'Warmup matters: the first iterations may include parsing, inline cache setup, baseline compilation, or optimizing compiler work that later iterations do not include.',
              'Do not benchmark no-ops, constant expressions, unused results, or impossible inputs. Engines can inline, fold constants, remove dead code, and specialize around stable shapes.',
              'Treat a big win as a hypothesis. Rerun the benchmark, inspect variance, compare at least one non-JIT baseline, and confirm the faster version still wins in the real path.',
            ],
          },
        ]}
        faqs={faqs}
        relatedLinks={SEO_LANDING_PAGES.filter((page) => page.href !== path)}
      />
    </>
  )
}
