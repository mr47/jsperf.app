import { pagesCollection } from '../lib/mongodb'
import TestRunner from '../components/TestRunner'
import marked from 'marked'
import DOMPurify from 'isomorphic-dompurify'
import {highlightSanitizedHTML, highlightSanitizedJS} from '../utils/hljs'
import Revisions from '../components/sections/Revisions'
import Info from '../components/sections/Info'
import Setup from '../components/sections/Setup'
import Teardown from '../components/sections/Teardown'
import PrepCode from '../components/sections/PrepCode'

export default function Slug(props) {
  const { _id, title, slug, revision, author, published, info, initHTML, setup, teardown, tests } = props.pageData
  const {revisions} = props

  return (
    <>
      <hgroup>
        <h1>{title}</h1>
        <h2>JavaScript performance comparison</h2>
      </hgroup>
      <p className="meta">
        {revision > 1
            ? <span>Revision {revision} of this test case</span>
            : <span>Test case</span>
        }
        <span> created by {author} </span>
        <time dateTime={published} pubdate="true">{published}</time>
      </p>
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
      {revisions &&
        <section>
          <Revisions revisions={revisions} />
        </section>
      }
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
    slug
  }, {projection: {slug: 1, revision: 1, published: 1} }).sort({revision: 1}).toArray()

  // console.log(revisions)
  if (!pageData) {
    return {
      notFound: true
    }
  }

  return { 
    props: { 
      pageData: JSON.parse(JSON.stringify(pageData)), // wtf bro
      revisions: JSON.parse(JSON.stringify(revisions)) // wtf bro
    },
    revalidate: 60
  }
}

export async function getStaticPaths() {
  const pages = await pagesCollection()

  const pagesQuery = await pages.find({}, {
    projection: { slug: 1, revision: 1, _id: 0 }
  }).toArray()

  const paths = pagesQuery.map(page => {
    return {
      params: {
        /**
         * Use base path where revision 1
         */
        slug: page.revision === '1'
          ? [page.slug]
          : [page.slug, `${page.revision}`]
      }
    }
  })

  // const paths = [{
  //   params: {
  //     slug: ['some-cool-test', '2']
  //   }
  // }]

  return {
    paths,
    fallback: 'blocking'
  };
}
