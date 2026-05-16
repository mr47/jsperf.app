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
import { useRouter } from 'next/router'
import ReportViewer from '../../components/report/ReportViewer'
import { Skeleton } from '@/components/ui/skeleton'
import { getReportById } from '../../lib/reports'

export default function ReportPage({ report, notFound }) {
  const router = useRouter()

  if (router.isFallback || (!report && !notFound)) {
    return <ReportLoadingSkeleton />
  }

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

function ReportLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100 text-foreground dark:bg-slate-950">
      <Head>
        <title>Loading report — jsperf.net</title>
      </Head>

      <div className="flex items-center gap-2 border-b bg-white/80 px-3 py-3 backdrop-blur dark:bg-slate-900/60 sm:px-5">
        <Skeleton className="h-4 w-4 rounded-full bg-violet-500/30" />
        <Skeleton className="h-4 w-28" />
        <div className="hidden h-5 w-px bg-border sm:block" />
        <Skeleton className="hidden h-4 w-72 sm:block" />
        <div className="ml-auto flex items-center gap-1.5">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      <main
        className="flex min-h-[calc(100vh-57px)] items-center justify-center p-3 sm:p-6"
        role="status"
        aria-live="polite"
        aria-label="Loading report"
      >
        <div className="w-full max-w-[1280px]">
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border bg-white shadow-xl dark:bg-slate-900">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-sky-500/10" />
            <div className="relative flex h-full flex-col justify-between p-5 sm:p-8 lg:p-12">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-24 bg-violet-500/30" />
                  <Skeleton className="h-9 w-[min(32rem,70vw)]" />
                  <Skeleton className="h-4 w-[min(24rem,55vw)]" />
                </div>
                <Skeleton className="h-16 w-16 rounded-2xl" />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>

              <div className="space-y-3">
                <Skeleton className="h-3 w-32" />
                <div className="grid gap-3 md:grid-cols-4">
                  <Skeleton className="h-12 rounded-lg" />
                  <Skeleton className="h-12 rounded-lg" />
                  <Skeleton className="h-12 rounded-lg" />
                  <Skeleton className="h-12 rounded-lg" />
                </div>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Preparing the presentation report and warming up the slide deck...
          </p>

          <div className="mt-5 flex gap-2 overflow-hidden">
            <Skeleton className="h-9 w-28 shrink-0" />
            <Skeleton className="h-9 w-32 shrink-0" />
            <Skeleton className="h-9 w-28 shrink-0" />
            <Skeleton className="h-9 w-36 shrink-0" />
          </div>
        </div>
      </main>
    </div>
  )
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
  // we don't pre-render any at build time. `true` lets the page show
  // a designed loading state while Next generates first-view reports.
  return { paths: [], fallback: true }
}
