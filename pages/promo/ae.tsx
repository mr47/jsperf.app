import Link from 'next/link'
import { signIn, useSession } from 'next-auth/react'
import { FormEvent, useState } from 'react'
import { ArrowRight, Check, Loader2, Sparkles, Zap, Presentation, Cpu } from 'lucide-react'
import SEO from '../../components/SEO'
import Layout from '../../components/Layout'
import GitHubIcon from '../../components/GitHubIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PROMO_CODE = 'AE'
const GITHUB_EMAIL_AUTH_PARAMS = { scope: 'read:user user:email' }

type PromoSessionUser = {
  name?: string | null
  email?: string | null
  emails?: string[]
}

function emitDonorUpdate(donor: unknown) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jsperf:donor-updated', {
    detail: { donor: donor || null },
  }))
}

export default function AgileEnginePromoPage() {
  const { data: session, status } = useSession()
  const [code, setCode] = useState(PROMO_CODE)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const signedIn = !!session?.user
  const user = session?.user as PromoSessionUser | undefined
  const emailCandidates = Array.from(new Set([
    user?.email,
    ...(Array.isArray(user?.emails) ? user.emails : []),
  ].map((candidate) => String(candidate || '').trim().toLowerCase()).filter(Boolean)))
  const agileEngineEmail = emailCandidates.find((candidate) => candidate.endsWith('@agileengine.com')) || ''
  const hasSharedEmail = emailCandidates.length > 0
  const isAgileEngineEmail = !!agileEngineEmail
  const loadingSession = status === 'loading'
  const signInWithEmailAccess = () => signIn('github', { callbackUrl: '/promo/ae' }, GITHUB_EMAIL_AUTH_PARAMS)

  const handleClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/donor/promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() || PROMO_CODE }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not activate the promo. Please try again.')
        return
      }

      emitDonorUpdate(data.donor)
      setSuccess(data.alreadyRedeemed ? 'Your AE donor boost is active again.' : 'Your AE donor boost is active for 30 days.')
      setCode(PROMO_CODE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SEO
        title="AgileEngine jsPerf Donor Boost"
        description="AgileEngine users can claim one free month of jsPerf donor perks with the AE promo code."
        canonical="/promo/ae"
        ogImage="/og-image.png"
        noindex
      />
      <Layout>
        <section className="relative py-16 sm:py-24">
          <div className="pointer-events-none absolute inset-x-0 top-8 -z-10 transform-gpu overflow-hidden blur-3xl" aria-hidden="true">
            <div className="mx-auto aspect-[1155/678] w-[42rem] max-w-full bg-gradient-to-tr from-amber-300 via-orange-400 to-pink-500 opacity-20" />
          </div>

          <div className="mx-auto max-w-3xl text-center space-y-6">
            <div className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-medium text-amber-700 dark:text-amber-300">
              <Sparkles className="mr-2 h-4 w-4" />
              AgileEngine promo
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight">
                One free month of jsPerf donor perks
              </h1>
              <p className="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground leading-relaxed">
                Sign in with your <span className="font-medium text-foreground">@agileengine.com</span> GitHub email
                and claim the <code className="font-mono text-foreground">AE</code> code to unlock higher limits,
                deep analysis, runtime comparison, and shareable reports.
              </p>
            </div>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-amber-500/30 bg-card/80 backdrop-blur-sm shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl">Claim your AE boost</CardTitle>
                <CardDescription>
                  The promo is tied to one AgileEngine email and lasts 30 days from activation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!signedIn && (
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      Start by signing in with GitHub. Your GitHub account must expose an AgileEngine email.
                    </p>
                    <Button onClick={signInWithEmailAccess} className="w-full sm:w-auto gap-2" disabled={loadingSession}>
                      <GitHubIcon fill="currentColor" width={16} height={16} />
                      Sign in with GitHub
                    </Button>
                  </div>
                )}

                {signedIn && (
                  <div className={`rounded-xl border p-4 ${isAgileEngineEmail ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                    <div className="text-sm font-medium">
                      Signed in as {agileEngineEmail || user?.email || user?.name || 'GitHub user'}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isAgileEngineEmail
                        ? 'This email is eligible for the AE promo.'
                        : hasSharedEmail
                        ? 'Use a GitHub account with an @agileengine.com email to claim this promo.'
                        : 'GitHub did not share an email with jsPerf. Reconnect and approve email access, then try again.'}
                    </p>
                    {!isAgileEngineEmail && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={signInWithEmailAccess}
                        className="mt-3 w-full sm:w-auto gap-2"
                      >
                        <GitHubIcon fill="currentColor" width={16} height={16} />
                        Reconnect GitHub email access
                      </Button>
                    )}
                  </div>
                )}

                <form onSubmit={handleClaim} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="ae-promo-code">Promo code</Label>
                    <Input
                      id="ae-promo-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      autoComplete="off"
                      maxLength={100}
                      disabled={!signedIn || !isAgileEngineEmail || submitting}
                      className="h-12 text-lg font-mono"
                    />
                  </div>

                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {success && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      {success}
                    </div>
                  )}

                  <Button type="submit" size="lg" disabled={!signedIn || !isAgileEngineEmail || submitting} className="w-full gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Claiming boost
                      </>
                    ) : (
                      <>
                        Claim free month
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Perk icon={Zap} title="Higher quotas" description="Create, edit, and submit benchmark runs with donor-tier rate limits." />
              <Perk icon={Cpu} title="Runtime comparison" description="Compare browser results with Node, Deno, Bun, QuickJS, and V8 analysis." />
              <Perk icon={Presentation} title="Presentation reports" description="Generate shareable frozen reports for benchmarks worth discussing with teammates." />
            </div>
          </div>

          <div className="mx-auto mt-8 flex max-w-3xl flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild variant="outline">
              <Link href="/create">Create a benchmark</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/latest">Browse latest benchmarks</Link>
            </Button>
          </div>
        </section>
      </Layout>
    </>
  )
}

function Perk({ icon: Icon, title, description }) {
  return (
    <Card className="bg-card/70 backdrop-blur-sm">
      <CardContent className="flex gap-4 p-5">
        <div className="shrink-0 h-11 w-11 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
