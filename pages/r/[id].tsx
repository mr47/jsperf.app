// @ts-nocheck
/**
 * /r/[id] — public report viewer.
 *
 * The link itself is the bearer token: anyone who has it can open the
 * deck (you can't enumerate IDs, the alphabet is 33^8 ≈ 1.4e12).
 * Reports are immutable, so we render with `getStaticProps` +
 * blocking fallback and revalidate every 5 minutes — this keeps the
 * Mongo collection cold for shared links.
 */
import Head from 'next/head'
import Link from 'next/link'
import ReportViewer from '../../components/report/ReportViewer'
import { getReportById } from '../../lib/reports'

export default function ReportPage({ report, notFound }) {
  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <Head>
          <title>Report not found — jsperf.net</title>
        </Head>
        <h1 className="text-3xl font-bold tracking-tight">Report not found</h1>
        <p className="mt-3 text-muted-foreground max-w-md">
          This presentation link is either expired, mistyped, or was
          deleted by the donor who created it.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to jsperf.net
        </Link>
      </div>
    )
  }

  return <ReportViewer report={report} />
}

export async function getStaticProps({ params }) {
  try {
    const report = await getReportById(params.id)
    if (!report) {
      return { props: { notFound: true }, revalidate: 60 }
    }
    const { _id, ...safe } = report
    return {
      props: { report: JSON.parse(JSON.stringify(safe)) },
      revalidate: 300,
    }
  } catch (err) {
    console.error('report page load failed', err)
    return { props: { notFound: true }, revalidate: 30 }
  }
}

export async function getStaticPaths() {
  // Reports are private-by-obscurity and there can be a lot of them;
  // we don't pre-render any at build time.
  return { paths: [], fallback: 'blocking' }
}
