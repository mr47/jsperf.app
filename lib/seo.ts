export const SITE_NAME = 'jsPerf'
export const DEFAULT_SITE_URL = 'https://jsperf.net'

const normalizeSiteUrl = (url: string) => url.replace(/\/+$/, '')

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL)

export const DEFAULT_SEO_TITLE = 'jsPerf - Online JavaScript and TypeScript Benchmark Tool'

export const DEFAULT_SEO_DESCRIPTION =
  'Run JavaScript and TypeScript benchmarks online. Compare code snippets by ops/sec, save shareable jsPerf tests, and analyze browser, V8, QuickJS, Node, Deno, and Bun behavior.'

export const DEFAULT_SEO_KEYWORDS = [
  'js benchmark',
  'javascript benchmark',
  'javascript benchmark online',
  'js performance test',
  'compare javascript performance',
  'typescript benchmark',
  'benchmark js',
  'ops/sec',
  'tinybench',
  'jsperf',
]

export function absoluteUrl(path = '/') {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${normalizedPath === '/' ? '' : normalizedPath}`
}

export function withSiteTitle(title?: string) {
  if (!title) {
    return DEFAULT_SEO_TITLE
  }

  return /\bjsPerf\b/i.test(title) ? title : `${title} | ${SITE_NAME}`
}

export function softwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: DEFAULT_SEO_DESCRIPTION,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Online JavaScript benchmarks',
      'Online TypeScript benchmarks',
      'Shareable benchmark URLs',
      'Browser ops/sec comparisons',
      'QuickJS and V8 deep analysis',
      'Node, Deno, and Bun runtime comparisons',
    ],
  }
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_SEO_DESCRIPTION,
  }
}

export function webPageSchema({ title, description, path }: { title: string; description: string; path: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: absoluteUrl(path),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
  }
}

export function faqPageSchema(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: answer,
      },
    })),
  }
}

export function breadcrumbSchema(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}
