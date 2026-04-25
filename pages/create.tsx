// @ts-nocheck
import SEO from '../components/SEO'
import Layout from '../components/Layout'
import EditForm from '../components/forms/Edit'

export default function Create(props) {
  return (
    <>
      <SEO 
        title="Create Test Case - jsPerf" 
        description="Create a new JavaScript or TypeScript performance benchmark test case on jsPerf.net" 
      />
      <Layout>
        <h1 className="font-bold text-3xl mb-6">Create a test case</h1>
        <EditForm />
      </Layout>
    </>
  )
}
