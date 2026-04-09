import Head from 'next/head'
import Layout from '../components/Layout'
import EditForm from '../components/forms/Edit'

export default function Create(props) {
  return (
    <>
      <Head>
        <title>Create Test Case - jsPerf</title>
        <meta
          name="description"
          content="Create a new JavaScript performance benchmark test case on jsPerf.net"
          key="desc"
        />
      </Head>
      <Layout>
        <h1 className="font-bold text-3xl mb-6">Create a test case</h1>
        <EditForm />
      </Layout>
    </>
  )
}
