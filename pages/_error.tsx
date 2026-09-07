import type { NextPageContext } from 'next'
import Link from 'next/link'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'

import SEO from '../components/SEO'
import Layout from '../components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type ErrorPageProps = {
  statusCode: number
}

/**
 * Custom error page. Its only job beyond rendering is to persist
 * server-side render failures (getStaticProps/getServerSideProps throws,
 * API-less 500s) into the admin error log, which the default Next.js
 * error page cannot do.
 */
function ErrorPage({ statusCode }: ErrorPageProps) {
  const isServerError = statusCode >= 500

  return (
    <>
        <SEO title={`${statusCode} error`} description="jsPerf hit an error while serving this page." canonical="/" ogImage="/og-image.png" noindex />
      <Layout>
        <section className="flex min-h-[60vh] items-center justify-center py-16">
          <Card className="w-full max-w-xl">
            <CardContent className="space-y-6 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    {isServerError ? 'Something went wrong' : `Error ${statusCode}`}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {isServerError
                      ? 'The server hit an unexpected error while rendering this page. It has been recorded.'
                      : 'The request could not be completed.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="secondary">
                  <Link href="/"><Home className="h-4 w-4" /> Go home</Link>
                </Button>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  <RotateCcw className="h-4 w-4" /> Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </Layout>
    </>
  )
}

ErrorPage.getInitialProps = async ({ res, err, req, pathname }: NextPageContext): Promise<ErrorPageProps> => {
  const statusCode = res?.statusCode ?? (err as { statusCode?: number } | null)?.statusCode ?? 404

  if (err && typeof window === 'undefined' && statusCode >= 500) {
    try {
      const { logServerError } = await import('../lib/errorLog')
      await logServerError('page.render', err, { req, status: statusCode, pathname })
    } catch (_) {
      // never let logging mask the original failure
    }
  }

  return { statusCode }
}

export default ErrorPage
