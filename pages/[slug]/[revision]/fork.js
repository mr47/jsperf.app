import SEO from '../../../components/SEO'

import { pagesCollection } from '../../../lib/mongodb'
import EditForm from '../../../components/forms/Edit'
import Layout from '../../../components/Layout'

export default function Fork({pageData}) {
  return (
    <>
      <SEO noindex={true} />
      <Layout>
        <div className="py-2"></div>
        <EditForm pageData={pageData} />
      </Layout>
    </>
  )
}

export async function getServerSideProps({params}) {
  const { slug, revision } = params

  const pages = await pagesCollection()

  const pageData = await pages.findOne({
    slug, revision: parseInt(revision) || 1
  }, {projection: { _id: 0 }})

  if (!pageData) {
    return {
      notFound: true
    }
  }

  // To make it a fork, we delete the unique identifiers
  // so the form submits it as a brand new snippet.
  delete pageData.slug
  delete pageData.revision
  delete pageData.uuid
  delete pageData.visible
  delete pageData.githubID

  // Prefix the title
  pageData.title = `Fork of ${pageData.title}`

  return {
    props: { 
      pageData: JSON.parse(JSON.stringify(pageData))
    }
  }
}
