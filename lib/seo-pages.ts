export const SEO_LANDING_PAGES = [
  {
    href: '/compare-javascript-performance',
    label: 'Compare JS Performance',
    description: 'Compare JavaScript functions and snippets by ops/sec in the browser.',
  },
  {
    href: '/typescript-benchmark',
    label: 'TypeScript Benchmark',
    description: 'Benchmark typed code online without rewriting it first.',
  },
  {
    href: '/javascript-runtime-benchmark',
    label: 'Runtime Benchmarks',
    description: 'Compare JavaScript behavior across browser, Node, Deno, Bun, V8, and QuickJS.',
  },
  {
    href: '/guide/how-to-benchmark-javascript',
    label: 'Benchmarking Guide',
    description: 'Learn how to design useful JavaScript microbenchmarks.',
  },
  {
    href: '/benchmarks/foreach-vs-for-loop',
    label: 'forEach vs for Loop',
    description: 'A practical benchmark topic page for JavaScript iteration performance.',
  },
  {
    href: '/alternatives/jsbench',
    label: 'JSBench Alternative',
    description: 'Compare jsPerf with browser-only JavaScript benchmarking playgrounds.',
  },
]

export const STATIC_SEO_PATHS = [
  '/',
  '/create',
  '/latest',
  ...SEO_LANDING_PAGES.map((page) => page.href),
]
