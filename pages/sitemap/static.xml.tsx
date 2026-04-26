// @ts-nocheck
import { STATIC_SEO_PATHS } from '../../lib/seo-pages'
import { absoluteUrl } from '../../lib/seo'

const StaticSitemap = () => {}

export const getServerSideProps = async ({ res }) => {
  const now = new Date().toISOString()
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${STATIC_SEO_PATHS.map((path) => {
      return `
        <url>
          <loc>${absoluteUrl(path)}</loc>
          <lastmod>${now}</lastmod>
        </url>
      `
    }).join('')}
    </urlset>
  `

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
  res.setHeader('Content-Type', 'text/xml')
  res.write(sitemap)
  res.end()

  return {
    props: {},
  }
}

export default StaticSitemap
