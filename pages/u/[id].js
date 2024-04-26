import Head from 'next/head'

import Layout from '../../components/Layout'
import Link from 'next/link'
import { pagesCollection } from '../../lib/mongodb'
import {datetimeLong} from '../../utils/Date'
import {useSession} from "next-auth/react";
export default function User(props) {
  const {published, unpublished, id} = props
  const { data: session, status } = useSession()
  const canView = (id && session?.user?.id) && (session?.user?.id === id)
  return (
    <>
      <Head>
        <title>jsPerf.app</title>
      </Head>
      <Layout>
        <ul>
          { published.map(({slug, revision, title, published, revisionCount, testsCount}, index) => {
              return (
                <li key={index}>
                  <Link href={`/${slug}/${revision}`}>
                    {title}
                  </Link>
                  <span> Published on <time dateTime={published}>
                    {datetimeLong(published)}
                  </time></span>
                  <span> [{testsCount} tests, {revisionCount} revision{`${revisionCount > 1 ? 's' : ''}`}]</span>
                </li>
              )
          }) }
          { canView && unpublished.map(({slug, revision, title, published, revisionCount, testsCount}, index) => {
            return (
                <li key={index}>
                  <Link href={`/${slug}/${revision}`}>
                    {title}
                  </Link>
                  <span> Created on <time dateTime={published}>
                    {datetimeLong(published)}
                  </time></span>
                  <span> [{testsCount} tests, {revisionCount} revision{`${revisionCount > 1 ? 's' : ''}`}]</span>
                </li>
            )
          }) }
        </ul>
      </Layout>
    </>
  )
}

export const getStaticProps = async ({params}) => {
  const {id} = params
  let pageData = []

  try {
    const pages = await pagesCollection()

    pageData = await pages.aggregate([
      {
        $match: { githubID: id }
      },
      {
        $project: {
          title: 1, slug: 1, revision: 1, published: 1, visible: 1, githubID: 1, testsCount: { $size: "$tests" }
        }
      },
      {
        $group : {
          _id : "$slug",
          revisionCount: {
            $sum: 1
          },
          document: {
            "$first": "$$ROOT"
          }
        }
      },
      {
        "$replaceRoot":{
          "newRoot": {
            $mergeObjects: [
              "$document",
              { revisionCount: "$revisionCount"}
            ]
          }
        }
      },
      {
        $sort: {
          published: -1
        }
      },
    ]).toArray()
  } catch (e) {
  }
  console.log(pageData.filter((r) => !r?.visible));
  return {
    props: {
      published: JSON.parse(JSON.stringify(pageData.filter(({visible}) => visible))),
      unpublished: JSON.parse(JSON.stringify(pageData.filter((r) => !r?.visible))),
      id,
    }
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  };
}
