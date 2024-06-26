import Head from 'next/head'

import { pagesCollection } from '../lib/mongodb'
import TestRunner from '../components/TestRunner'

import Layout from '../components/Layout'

import Meta from '../components/sections/Meta'
import Revisions from '../components/sections/Revisions'
import Info from '../components/sections/Info'
import Setup from '../components/sections/Setup'
import Teardown from '../components/sections/Teardown'
import PrepCode from '../components/sections/PrepCode'

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
  } = props.pageData

  const {revisions} = props

  return (
    <>
      <Head>
        <title>{`${title}${revision > 1 ? ` (v${revision})` : ''}`}</title>
        <meta
          name="description"
          content={`${title}${revision > 1 ? ` (v${revision})` : ''} - Online Javascript Benchmark${mirror ? ' - jsPerf.com mirror' : ''}`}
          key="desc"
        />
      </Head>
      <Layout>
        <hgroup>
          <h1 className="text-2xl py-6 font-bold">{title}<span className="text-gray-400 text-base">{`${revision > 1 ? ` (v${revision})` : ''}`}</span></h1>
        </hgroup>
        <section>
          <Meta pageData={props.pageData} />
        </section>
        <hr className="my-5" />
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
            <Setup setup={setup} />
          </section>
        }
        {teardown &&
          <section>
            <Teardown teardown={teardown} />
          </section>
        }
        <section>
          <TestRunner id={_id} tests={tests} />
        </section>
        <hr className="my-5" />
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
