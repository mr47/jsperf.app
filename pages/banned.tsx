import Link from 'next/link'
import { useRouter } from 'next/router'
import { Ban, Home, Mail } from 'lucide-react'

import SEO from '../components/SEO'
import Layout from '../components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Landing page for banned accounts. NextAuth's signIn callback redirects
 * here instead of creating a session. Banned users can still browse
 * public benchmarks; only sign-in and write endpoints are blocked.
 */
export default function BannedPage() {
  const router = useRouter()
  const untilParam = typeof router.query.until === 'string' ? router.query.until : null
  const until = untilParam ? new Date(untilParam) : null
  const untilValid = until && !Number.isNaN(until.getTime())

  return (
    <>
        <SEO title="Account suspended" description="This jsPerf account is suspended." canonical="/banned" ogImage="/og-image.png" noindex />
      <Layout>
        <section className="flex min-h-[60vh] items-center justify-center py-16">
          <Card className="w-full max-w-xl border-destructive/30">
            <CardContent className="space-y-6 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <Ban className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Account suspended</h1>
                  <p className="text-sm text-muted-foreground">
                    {untilValid
                      ? <>Sign-in is disabled until <time dateTime={until.toISOString()}>{until.toUTCString()}</time>.</>
                      : 'Sign-in for this GitHub account has been disabled.'}
                  </p>
                </div>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                You can still browse and run public benchmarks. Creating, editing, submitting runs and deep analysis are
                unavailable while the suspension is active. If you believe this is a mistake, get in touch and include
                your GitHub username.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="secondary">
                  <Link href="/"><Home className="h-4 w-4" /> Go home</Link>
                </Button>
                <Button asChild variant="outline">
                  <a href="https://github.com/mr47/jsperf.app/issues" target="_blank" rel="noopener noreferrer">
                    <Mail className="h-4 w-4" /> Contact
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </Layout>
    </>
  )
}
