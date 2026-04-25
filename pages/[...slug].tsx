// @ts-nocheck
import SEO from '../components/SEO'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { GitFork } from 'lucide-react'

import { pagesCollection } from '../lib/mongodb'
import TestRunner from '../components/TestRunner'
import GenerateReportButton from '../components/GenerateReportButton'
import { bumpDateIfOld } from '../utils/DateBump'

import Layout from '../components/Layout'

import Meta from '../components/sections/Meta'
import Revisions from '../components/sections/Revisions'
import Info from '../components/sections/Info'
import Setup from '../components/sections/Setup'
import Teardown from '../components/sections/Teardown'
import PrepCode from '../components/sections/PrepCode'
import { Separator } from '@/components/ui/separator'

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

  return (
    <>
      <SEO 
        title={`${title}${revision > 1 ? ` (v${revision})` : ''}`}
        description={`${title}${revision > 1 ? ` (v${revision})` : ''} - Online Javascript Benchmark${mirror ? ' - jsPerf.com mirror' : ''}`}
      />
      <Layout>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-6">
          <hgroup>
            <h1 className="text-3xl font-bold tracking-tight">{title} <span className="text-muted-foreground text-xl font-normal ml-2">{`${revision > 1 ? `(v${revision})` : ''}`}</span></h1>
          </hgroup>
          <div className="flex flex-wrap items-center gap-2">
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

  const pages = await pagesCollection()

  const pageData = await pages.findOne({
    slug, revision: parseInt(revision) || 1
  })

  const revisions = await pages.find({
    slug, visible: true
  }, {projection: {slug: 1, revision: 1, authorName: 1, published: 1} }).sort({revision: 1}).toArray()

  if (!pageData || !pageData.visible) {
    return {
      notFound: true
    }
  }

  // Bump dates dynamically to look alive
  if (pageData.published) {
    pageData.published = bumpDateIfOld(pageData.published, pageData.slug)
  }
  revisions.forEach(rev => {
    if (rev.published) {
      rev.published = bumpDateIfOld(rev.published, rev.slug)
    }
  })

  return {
    props: {
      pageData: JSON.parse(JSON.stringify(pageData)),
      revisions: JSON.parse(JSON.stringify(revisions))
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
