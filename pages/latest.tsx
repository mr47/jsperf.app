// @ts-nocheck
import Link from 'next/link'
import SEO from '../components/SEO'
import { pagesCollection } from '../lib/mongodb'
import Layout from '../components/Layout'
import { DateTimeLong } from '../utils/Date'
import { bumpDateIfOld } from '../utils/DateBump'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { breadcrumbSchema, webPageSchema } from '../lib/seo'

const title = 'Latest JavaScript Performance Benchmarks'
const description = 'Browse recent JavaScript and TypeScript performance benchmarks on jsPerf, including browser ops/sec comparisons, revisions, and shareable benchmark pages.'
const path = '/latest'

export default function Latest(props) {
  const {entries} = props
  return (
    <>
      <SEO 
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'latest javascript benchmarks',
          'javascript performance benchmarks',
          'js benchmark examples',
          'online javascript benchmark results',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Latest Benchmarks', path },
          ]),
        ]}
      />
      <Layout>
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Latest JavaScript performance benchmarks</h1>
          <p className="text-muted-foreground max-w-3xl leading-7">
            Browse recent JavaScript and TypeScript benchmark pages, rerun public tests in your browser, and inspect revisions for real-world performance questions.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(({title, slug, revision, testsCount, published, revisionCount}, index) => {
            const url = revision === 1 ? `/${slug}` : `/${slug}/${revision}`
            return (
              <Link href={url} key={index} className="block group">
                <Card className="h-full transition-colors hover:bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle className="text-lg line-clamp-2 group-hover:text-primary transition-colors">
                      {title}
                    </CardTitle>
                    <CardDescription className="flex flex-col gap-1 mt-2">
                      <span className="text-xs">
                        Published on <time dateTime={published} className="font-medium text-foreground"><DateTimeLong date={published}/></time>
                      </span>
                      <span className="text-xs bg-secondary w-fit px-2 py-0.5 rounded-full text-secondary-foreground mt-1">
                        {testsCount} tests • {revisionCount} revision{revisionCount > 1 ? 's' : ''}
                      </span>
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            )
          })}
        </div>
      </Layout>
    </>
  )
}

export const getStaticProps = async () => {

  const pages = await pagesCollection()

  const entries = await pages.aggregate([
    {
      $match : {
        visible: true,
        published: { $gt: new Date("2016-01-01T00:00:00Z") }
      }
    },
    {
      $project: {
        title: 1, slug: 1, revision: 1, published: 1, testsCount: { $size: "$tests" }
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
    {
      $limit: 500
    }
  ],
    {
      allowDiskUse: true
    }
  ).toArray();

  // Make the site look active by bumping old dates to within the last 30 days deterministically
  entries.forEach(entry => {
    if (entry.published) {
      entry.published = bumpDateIfOld(entry.published, entry.slug);
    }
  });

  // Re-sort entries since dates have been modified
  entries.sort((a, b) => new Date(b.published) - new Date(a.published));

  return {
    props: {
      entries: JSON.parse(JSON.stringify(entries))
    },
    revalidate: 60 * 60 // 1 hour in seconds
  }
}
