import Head from 'next/head'
import { useRouter } from 'next/router'

export default function SEO({ 
  title, 
  description, 
  canonical, 
  ogImage, 
  ogType = 'website',
  twitterHandle = '@jsperf',
  noindex = false
}) {
  const router = useRouter()
  
  const siteName = 'jsPerf - JavaScript Performance Benchmark'
  const defaultTitle = siteName
  const defaultDescription = 'jsPerf is an online JavaScript performance benchmark test runner. Write, share, and compare execution speed of your JavaScript code snippets right in the browser.'
  
  const seoTitle = title ? `${title} | jsPerf` : defaultTitle
  const seoDescription = description || defaultDescription
  const siteUrl = 'https://jsperf.app'
  
  // Use specific canonical URL or fallback to the current path
  const canonicalUrl = canonical || `${siteUrl}${router.asPath === '/' ? '' : router.asPath}`
  
  // Default OG image or specific
  const ogImageUrl = ogImage || `${siteUrl}/og-image.jpg` // Assuming a default OG image exists or will exist

  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{seoTitle}</title>
      <meta name="title" content={seoTitle} />
      <meta name="description" content={seoDescription} />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:title" content={seoTitle} />
      <meta property="og:description" content={seoDescription} />
      <meta property="og:image" content={ogImageUrl} />
      <meta property="og:site_name" content={siteName} />

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={canonicalUrl} />
      <meta property="twitter:title" content={seoTitle} />
      <meta property="twitter:description" content={seoDescription} />
      <meta property="twitter:image" content={ogImageUrl} />
      {twitterHandle && <meta name="twitter:creator" content={twitterHandle} />}
      {twitterHandle && <meta name="twitter:site" content={twitterHandle} />}
      
      {noindex && <meta name="robots" content="noindex,follow" />}
      <meta name="keywords" content="javascript, benchmark, performance, jsperf, testing, web development, coding, snippet, tinybench" />
      <meta name="author" content="Dmytro Piddubnyi <https://mr47.in>" />
    </Head>
  )
}
