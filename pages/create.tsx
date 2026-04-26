// @ts-nocheck
import SEO from '../components/SEO'
import Layout from '../components/Layout'
import EditForm from '../components/forms/Edit'
import { breadcrumbSchema, webPageSchema } from '../lib/seo'

const title = 'Create a JavaScript Benchmark Online'
const description = 'Create a JavaScript or TypeScript performance benchmark online. Add setup code, compare snippets by ops/sec, save revisions, and share the result with your team.'
const path = '/create'

export default function Create(props) {
  return (
    <>
      <SEO 
        title={title}
        description={description}
        canonical={path}
        keywords={[
          'create javascript benchmark',
          'javascript benchmark online',
          'typescript benchmark online',
          'js performance test',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Create Benchmark', path },
          ]),
        ]}
      />
      <Layout>
        <div className="mb-8 max-w-3xl">
          <h1 className="font-bold text-3xl mb-3">Create a JavaScript benchmark online</h1>
          <p className="text-muted-foreground leading-7">
            Add shared setup code, define JavaScript or TypeScript test cases, run browser ops/sec comparisons, and save a shareable jsPerf benchmark URL.
          </p>
        </div>
        <EditForm />
      </Layout>
    </>
  )
}
