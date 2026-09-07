// @ts-nocheck
import SEO from '../components/SEO'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { GitFork, Minimize2 } from 'lucide-react'

import TestRunner from '../components/TestRunner'
import GenerateReportButton from '../components/GenerateReportButton'

import Layout from '../components/Layout'

import Meta from '../components/sections/Meta'
import Revisions from '../components/sections/Revisions'
import Info from '../components/sections/Info'
import Setup from '../components/sections/Setup'
import Teardown from '../components/sections/Teardown'
import PrepCode from '../components/sections/PrepCode'
import { Separator } from '@/components/ui/separator'
import { benchmarkOgImagePath, benchmarkOgVersion } from '../lib/benchmarkOg'
import { absoluteUrl, breadcrumbSchema } from '../lib/seo'
import { loadBenchmarkPageData } from '../lib/benchmark/pageData'
import { benchmarkPath, compactBenchmarkPath } from '../lib/benchmark/paths'

export default function Slug(props) {
  const {
    _id,
    authorName,
    info,
    initHTML,
    published,
    revision,
    setup,
    slug,
    teardown,
    tests,
    title,
    mirror,
    language,
    languageOptions,
  } = props.pageData

  const {revisions} = props
  const { data: session } = useSession()
  const pagePath = benchmarkPath(slug, revision)
  const compactPath = compactBenchmarkPath(slug, revision)
  const benchmarkTitle = `${title}${revision > 1 ? ` (v${revision})` : ''}`
  const benchmarkDescription = `${benchmarkTitle} - online JavaScript${language === 'typescript' ? ' and TypeScript' : ''} benchmark with ${tests.length} test${tests.length === 1 ? '' : 's'}${mirror ? ' from the jsPerf.com mirror' : ''}.`
  const benchmarkOgImage = benchmarkOgImagePath({
    slug,
    revision,
    version: benchmarkOgVersion(props.pageData),
  })
  const benchmarkSchema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: benchmarkTitle,
    description: benchmarkDescription,
    url: absoluteUrl(pagePath),
    datePublished: published,
    author: authorName ? {
      '@type': 'Person',
      name: authorName,
    } : undefined,
    about: [
      'JavaScript benchmark',
      'JavaScript performance',
      ...(language === 'typescript' ? ['TypeScript benchmark'] : []),
    ],
  }

  return (
    <>
      <SEO 
        title={benchmarkTitle}
        description={benchmarkDescription}
        canonical={pagePath}
        ogImage={benchmarkOgImage}
        keywords={[
          title,
          'online javascript benchmark',
          'javascript performance test',
          ...(language === 'typescript' ? ['typescript benchmark'] : []),
        ]}
        jsonLd={[
          benchmarkSchema,
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Latest Benchmarks', path: '/latest' },
            { name: benchmarkTitle, path: pagePath },
          ]),
        ]}
      />
      <Layout>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-6">
          <hgroup>
            <h1 className="text-3xl font-bold tracking-tight">{title} <span className="text-muted-foreground text-xl font-normal ml-2">{`${revision > 1 ? `(v${revision})` : ''}`}</span></h1>
          </hgroup>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={compactPath} className="inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <Minimize2 className="w-3.5 h-3.5 mr-1.5" />
              Compact view
            </Link>
            <GenerateReportButton slug={slug} revision={revision} />
            {session && (
              <Link href={`/${slug}/${revision}/fork`} className="inline-flex shrink-0 items-center justify-center rounded-md text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring border border-input bg-background shadow-sm hover:bg-muted hover:text-accent-foreground h-9 px-4 py-2 gap-2">
                <GitFork className="w-4 h-4" />
                Fork
              </Link>
            )}
          </div>
        </div>
        <section>
          <Meta pageData={props.pageData} />
        </section>
        <Separator className="my-6" />
        {info &&
          <section>
            <Info info={info} />
          </section>
        }
        {initHTML &&
          <section>
            <PrepCode prepCode={initHTML} />
          </section>
        }
        {setup &&
          <section>
            <Setup setup={setup} language={language} />
          </section>
        }
        {teardown &&
          <section>
            <Teardown teardown={teardown} language={language} />
          </section>
        }
        <section>
          <TestRunner id={_id} slug={slug} revision={revision} tests={tests} setup={setup} teardown={teardown} language={language} languageOptions={languageOptions} />
        </section>
        <Separator className="my-6" />
        <section>
          <Revisions revisions={revisions} slug={slug} revision={revision} />
        </section>
      </Layout>
    </>
  )
}

export const getStaticProps = async ({params}) => {
  const [ slug, revision ] = params.slug

  /**
   * Redirect revision 1 so we don't have a duplicate URL
   */
  if (revision === '1') {
    return {
      redirect: {
        destination: "/" + slug,
      },
    }
  }

  const data = await loadBenchmarkPageData(slug, revision)

  if (!data) {
    return {
      notFound: true
    }
  }

  return {
    props: {
      pageData: JSON.parse(JSON.stringify(data.pageData)),
      revisions: JSON.parse(JSON.stringify(data.revisions))
    },
    revalidate: 60 * 60 * 24 // 1 day in seconds
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  };
}
