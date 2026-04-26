// @ts-nocheck
import Head from 'next/head'
import { useRouter } from 'next/router'
import {
  DEFAULT_SEO_DESCRIPTION,
  DEFAULT_SEO_KEYWORDS,
  DEFAULT_SEO_TITLE,
  SITE_NAME,
  absoluteUrl,
  withSiteTitle,
} from '../lib/seo'

export default function SEO({ 
  title, 
  description, 
  canonical, 
  ogImage, 
  ogType = 'website',
  twitterHandle = '@jsperf',
  noindex = false,
  keywords = [],
  jsonLd = [],
}) {
  const router = useRouter()
  const routePath = (router.asPath || '/').split(/[?#]/)[0]
  const seoTitle = title ? withSiteTitle(title) : DEFAULT_SEO_TITLE
  const seoDescription = description || DEFAULT_SEO_DESCRIPTION
  const canonicalUrl = absoluteUrl(canonical || routePath)
  const ogImageUrl = absoluteUrl(ogImage || '/og-image.png')
  const keywordList = Array.from(
    new Set([
      ...DEFAULT_SEO_KEYWORDS,
      ...(Array.isArray(keywords) ? keywords : String(keywords).split(',').map((keyword) => keyword.trim())),
    ].filter(Boolean))
  ).join(', ')
  const jsonLdItems = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).filter(Boolean)

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
      <meta property="og:site_name" content={SITE_NAME} />

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={canonicalUrl} />
      <meta property="twitter:title" content={seoTitle} />
      <meta property="twitter:description" content={seoDescription} />
      <meta property="twitter:image" content={ogImageUrl} />
      {twitterHandle && <meta name="twitter:creator" content={twitterHandle} />}
      {twitterHandle && <meta name="twitter:site" content={twitterHandle} />}

      <meta name="robots" content={noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'} />
      <meta name="keywords" content={keywordList} />
      <meta name="author" content="Dmytro Piddubnyi <https://mr47.in>" />
      {jsonLdItems.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
    </Head>
  )
}
