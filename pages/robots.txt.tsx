// @ts-nocheck
import { absoluteUrl } from '../lib/seo'

const Robots = () => {}

export const getServerSideProps = async ({ res }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
  ].join('\n')

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
  res.setHeader('Content-Type', 'text/plain')
  res.write(body)
  res.end()

  return {
    props: {},
  }
}

export default Robots
