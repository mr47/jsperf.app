import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { signIn, useSession } from 'next-auth/react'
import { Coffee, Sparkles, X, Loader2, Zap, Heart, Check, Presentation, Microscope, Gauge, Cpu, BarChart3, Stethoscope } from 'lucide-react'
import GitHubIcon from './GitHubIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DONATELLO_URL = 'https://donatello.to/mr47'
const GITHUB_EMAIL_AUTH_PARAMS = { scope: 'read:user user:email' }

const DONOR_PERKS = [
  {
    icon: Zap,
    label: 'Save and edit benchmarks',
    detail: '60 / min',
    sub: 'Higher create and update quota',
  },
  {
    icon: BarChart3,
    label: 'Submit benchmark runs',
    detail: '60 / min',
    sub: 'More stored browser run payloads',
  },
  {
    icon: Microscope,
    label: 'Deep analysis',
    detail: '10 / 5 min',
    sub: 'QuickJS, V8, JIT, memory, and complexity',
  },
  {
    icon: Cpu,
    label: 'Runtime comparison',
    detail: 'Included',
    sub: 'Node, Deno, Bun, and hardware counters',
  },
  {
    icon: Gauge,
    label: 'Compatibility matrix',
    detail: 'Unlocked',
    sub: 'Browser and runtime rankings',
  },
  {
    icon: Stethoscope,
    label: 'Benchmark Doctor',
    detail: 'Included',
    sub: 'Warnings for misleading microbenchmarks',
  },
  {
    icon: Presentation,
    label: 'Presentation reports',
    detail: '30 / hour',
    sub: 'Shareable frozen slide decks',
  },
]

function emitDonorUpdate(donor) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('jsperf:donor-updated', {
    detail: { donor: donor || null },
  }))
}

/**
 * Header CTA + full Support / Donor-boost modal.
 *
 *   - Anonymous users see "Buy me a coffee" in the header. Clicking
 *     opens a centered modal (bottom sheet on mobile) explaining the
 *     two ways to claim a boost: sign in with GitHub for an automatic
 *     match, or paste a Donatello name + code for manual verification.
 *   - Verified donors see "Boosted" in the header. The modal then
 *     shows their thank-you panel with details and a "Donate again"
 *     action (and a "Sign out" button for cookie-based donors).
 *
 * The modal renders into a portal so it can break out of any header
 * stacking context, and locks body scroll while open.
 */
export default function DonorBoost() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const [donor, setDonor] = useState(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [mounted, setMounted] = useState(false)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const nameInputRef = useRef(null)

  useEffect(() => { setMounted(true) }, [])

  // Hydrate donor status on mount and re-check whenever the user
  // signs in (so the email-based auto-match flips the badge without
  // a page reload).
  useEffect(() => {
    let cancelled = false
    setLoadingMe(true)
    fetch('/api/donor/me')
      .then(r => r.ok ? r.json() : { donor: null })
      .then(data => {
        if (cancelled) return
        const nextDonor = data?.donor || null
        setDonor(nextDonor)
        emitDonorUpdate(nextDonor)
      })
      .catch(() => {
        if (cancelled) return
        setDonor(null)
        emitDonorUpdate(null)
      })
      .finally(() => { if (!cancelled) setLoadingMe(false) })
    return () => { cancelled = true }
  }, [session?.user?.email])

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Other parts of the app (e.g. the "Generate report" button on the
  // benchmark page) can open this modal directly by dispatching this
  // global event — saves us from threading a context through Layout.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('jsperf:open-donor-modal', onOpen)
    return () => window.removeEventListener('jsperf:open-donor-modal', onOpen)
  }, [])

  useEffect(() => {
    if (showForm && nameInputRef.current) nameInputRef.current.focus()
  }, [showForm])

  const handleVerify = async (e) => {
    e?.preventDefault?.()
    if (!name.trim()) {
      setError('Enter the name you used on Donatello.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/donor/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not verify your donation.')
        return
      }
      setDonor(data.donor)
      emitDonorUpdate(data.donor)
      setSuccess('Boost activated. Thank you!')
      setShowForm(false)
      setName('')
      setCode('')
    } catch (err) {
      setError(err?.message || 'Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRedeemPromo = async (e) => {
    e?.preventDefault?.()
    if (!signedIn) {
      setError('Sign in with GitHub before redeeming a promo code.')
      return
    }
    if (!promoCode.trim()) {
      setError('Enter your promo code.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/donor/promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not redeem promo code.')
        return
      }
      setDonor(data.donor)
      emitDonorUpdate(data.donor)
      setSuccess(data.alreadyRedeemed ? 'Promo boost restored.' : 'Promo boost activated for 30 days.')
      setPromoCode('')
    } catch (err) {
      setError(err?.message || 'Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    try { await fetch('/api/donor/me', { method: 'DELETE' }) } catch (_) { /* ignore */ }
    setDonor(null)
    emitDonorUpdate(null)
    setSuccess(null)
    setError(null)
  }

  const isDonor = !!donor
  const signedIn = !!session?.user
  const loadingTrigger = loadingMe || status === 'loading'

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`text-sm font-medium transition-colors flex min-w-36 items-center justify-start gap-1.5 ${
        loadingTrigger
          ? 'text-muted-foreground'
          : isDonor
          ? 'text-amber-600 dark:text-amber-400 hover:text-amber-500'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-busy={loadingTrigger}
    >
      {loadingTrigger ? (
        <>
          <span className="inline-block w-4 h-4 rounded-full bg-muted-foreground/20 animate-pulse" aria-hidden="true" />
          <span className="inline-block h-4 w-24 rounded bg-muted-foreground/20 animate-pulse" aria-hidden="true" />
          <span className="sr-only">Checking boost status</span>
        </>
      ) : isDonor ? (
        <>
          <Sparkles className="w-4 h-4" />
          <span>Boosted</span>
        </>
      ) : (
        <>
          <Coffee className="w-4 h-4" />
          <span>Buy me a coffee</span>
        </>
      )}
    </button>
  )

  return (
    <>
      {trigger}
      {mounted && open && createPortal(
        <DonorBoostModal
          donor={donor}
          isDonor={isDonor}
          loadingMe={loadingMe}
          showForm={showForm}
          setShowForm={(v) => { setShowForm(v); setError(null) }}
          signedIn={signedIn}
          onClose={() => setOpen(false)}
          onSignIn={() => signIn('github', undefined, GITHUB_EMAIL_AUTH_PARAMS)}
          onSignOut={handleSignOut}
          onSubmitVerify={handleVerify}
          onSubmitPromo={handleRedeemPromo}
          name={name}
          code={code}
          promoCode={promoCode}
          setName={setName}
          setCode={setCode}
          setPromoCode={setPromoCode}
          nameInputRef={nameInputRef}
          submitting={submitting}
          error={error}
          success={success}
        />,
        document.body,
      )}
    </>
  )
}

function DonorBoostModal(props) {
  const {
    donor, isDonor, loadingMe, showForm, setShowForm, signedIn,
    onClose, onSignIn, onSignOut, onSubmitVerify, onSubmitPromo,
    name, code, promoCode, setName, setCode, setPromoCode, nameInputRef,
    submitting, error, success,
  } = props

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="donor-boost-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — bottom sheet on mobile, centered card on sm+ */}
      <div
        className="relative w-full sm:w-auto sm:max-w-3xl sm:mx-4 max-h-[92vh] overflow-y-auto
                   bg-card text-card-foreground border border-border shadow-2xl
                   rounded-t-2xl sm:rounded-2xl
                   animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 fade-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-5 sm:px-8 pt-4 sm:pt-8 pb-8 sm:pb-10">
          <Header isDonor={isDonor} donor={donor} />

          <div className="mt-6 sm:mt-8">
            {loadingMe && <LoadingState />}

            {!loadingMe && isDonor && (
              <DonorView donor={donor} onSignOut={onSignOut} />
            )}

            {!loadingMe && !isDonor && !showForm && (
              <ClaimView
                signedIn={signedIn}
                onSignIn={onSignIn}
                onShowForm={() => setShowForm(true)}
                onSubmitPromo={onSubmitPromo}
                promoCode={promoCode}
                setPromoCode={setPromoCode}
                submitting={submitting}
                error={error}
                success={success}
              />
            )}

            {!loadingMe && !isDonor && showForm && (
              <ClaimForm
                name={name}
                code={code}
                setName={setName}
                setCode={setCode}
                nameInputRef={nameInputRef}
                onSubmit={onSubmitVerify}
                submitting={submitting}
                error={error}
                onBack={() => setShowForm(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Header({ isDonor, donor }) {
  if (isDonor) {
    return (
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
        </div>
        <div className="min-w-0">
          <h2 id="donor-boost-title" className="text-xl sm:text-2xl font-bold tracking-tight">
            Boost active
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Thanks for keeping jsPerf alive,{' '}
            <span className="font-medium text-foreground">{donor?.name}</span>!
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-rose-400 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
        <Heart className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="currentColor" />
      </div>
      <div className="min-w-0">
        <h2 id="donor-boost-title" className="text-xl sm:text-2xl font-bold tracking-tight">
          Support jsPerf
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          jsPerf runs on a hobby budget. Donations keep the deep-analysis
          sandbox and multi-runtime workers humming.
        </p>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Checking your status…
    </div>
  )
}

function DonorPerksGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {DONOR_PERKS.map(perk => (
        <Perk key={perk.label} {...perk} />
      ))}
    </div>
  )
}

function Perk({ icon: Icon, label, detail, sub }) {
  return (
    <div className="rounded-lg bg-background border px-3 py-3">
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 w-8 h-8 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-base font-semibold mt-0.5 tabular-nums">{detail}</div>
          <div className="text-xs text-muted-foreground/70 mt-0.5 leading-snug">{sub}</div>
        </div>
      </div>
    </div>
  )
}

function DonorView({ donor, onSignOut }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
        <div className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold mb-2">
          Active boost
        </div>
        <DonorPerksGrid />
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {donor?.amount > 0 && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Last donation</dt>
            <dd className="font-semibold mt-0.5">
              {donor.amount} {donor.currency || 'UAH'}
            </dd>
          </div>
        )}
        {donor?.tierName && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Tier</dt>
            <dd className="font-semibold mt-0.5 truncate">{donor.tierName}</dd>
          </div>
        )}
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Matched via</dt>
          <dd className="font-semibold mt-0.5">
            {donor?.via === 'email'
              ? 'GitHub email'
              : donor?.via === 'promo'
              ? 'Promo code'
              : 'Donation code'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        {donor?.via !== 'email' && (
          <Button variant="ghost" onClick={onSignOut}>Sign out of donor mode</Button>
        )}
        <a href={DONATELLO_URL} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="w-full sm:w-auto flex items-center gap-2">
            <Coffee className="w-4 h-4" />
            <span>Donate again</span>
          </Button>
        </a>
      </div>
    </div>
  )
}

function ClaimView({
  signedIn, onSignIn, onShowForm, onSubmitPromo,
  promoCode, setPromoCode, submitting, error, success,
}) {
  return (
    <div className="space-y-6">
      {/* Perks card */}
      <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          What you get for any donation
        </div>
        <DonorPerksGrid />
        <div className="text-xs text-muted-foreground mt-3">Boost lasts 30 days, automatically refreshed for active subscribers.</div>
      </div>

      {/* Donate CTA */}
      <a
        href={DONATELLO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <Button className="w-full h-12 text-base flex items-center gap-2 bg-gradient-to-br from-rose-500 to-pink-600 hover:from-rose-500/90 hover:to-pink-600/90 text-white border-0 shadow-md">
          <Coffee className="w-5 h-5" />
          <span>Donate on Donatello</span>
        </Button>
      </a>

      <PromoClaim
        signedIn={signedIn}
        onSignIn={onSignIn}
        code={promoCode}
        setCode={setPromoCode}
        onSubmit={onSubmitPromo}
        submitting={submitting}
        error={error}
      />

      {/* Two paths */}
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          After you donate
        </div>

        <Path
          step={1}
          title="Sign in with GitHub"
          description={
            signedIn
              ? "You're already signed in — your boost will activate automatically as soon as your donation is processed."
              : "Use the same email as your Donatello account for an instant, automatic match. No codes needed."
          }
          action={signedIn ? null : (
            <Button onClick={onSignIn} variant="outline" className="w-full sm:w-auto flex items-center gap-2">
              <GitHubIcon fill="currentColor" width={16} height={16} />
              <span>Sign in with GitHub</span>
            </Button>
          )}
          done={signedIn}
        />

        <Path
          step={2}
          title="Or claim with a code"
          description={
            <>
              Donating without GitHub? Use the donation id from your Donatello
              receipt (e.g. <code className="font-mono text-foreground">D64-T243519</code>)
              or include a short word in the donation message — paste either
              one here to claim the boost.
            </>
          }
          action={
            <Button onClick={onShowForm} variant="outline" className="w-full sm:w-auto">
              I already donated
            </Button>
          }
        />
      </div>

      {success && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
          <Check className="w-4 h-4" /> {success}
        </div>
      )}
    </div>
  )
}

function PromoClaim({ signedIn, onSignIn, code, setCode, onSubmit, submitting, error }) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
          Promo code
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          AgileEngine folks can use <code className="font-mono text-foreground">AE</code> for one free month
          of donor perks with an <code className="font-mono text-foreground">@agileengine.com</code> GitHub email.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="promo-code" className="sr-only">Promo code</Label>
          <Input
            id="promo-code"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="AE"
            autoComplete="off"
            maxLength={100}
            disabled={!signedIn || submitting}
            className="h-11"
          />
        </div>
        <Button
          type={signedIn ? 'submit' : 'button'}
          variant="outline"
          onClick={signedIn ? undefined : onSignIn}
          disabled={submitting}
          className="h-11 sm:min-w-40"
        >
          {submitting ? (
            <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Claiming…</span>
          ) : signedIn ? (
            'Claim free month'
          ) : (
            'Sign in to claim'
          )}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </form>
  )
}

function Path({ step, title, description, action, done = false }) {
  return (
    <div className={`rounded-xl border p-4 sm:p-5 transition-colors ${done ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-card hover:bg-muted/20'}`}>
      <div className="flex items-start gap-3 sm:gap-4">
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
          done
            ? 'bg-emerald-500 text-white'
            : 'bg-muted text-muted-foreground'
        }`}>
          {done ? <Check className="w-4 h-4" /> : step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{title}</div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  )
}

function ClaimForm({ name, code, setName, setCode, nameInputRef, onSubmit, submitting, error, onBack }) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="donor-name">Donor name</Label>
        <Input
          id="donor-name"
          ref={nameInputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="The name you used on Donatello"
          autoComplete="off"
          maxLength={100}
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="donor-code">
          Verification code{' '}
          <span className="text-muted-foreground font-normal">(donation id or message word)</span>
        </Label>
        <Input
          id="donor-code"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. D64-T243519 or boost-cat42"
          autoComplete="off"
          maxLength={100}
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">
          Use either the donation id from your Donatello receipt
          (e.g. <code className="font-mono">D64-T243519</code>) or
          a short word you put in the donation message. Without a code
          we match by name across recent donations only, which is
          slightly less reliable.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </Button>
        <Button type="submit" disabled={submitting} className="sm:min-w-32">
          {submitting ? (
            <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</span>
          ) : (
            'Verify donation'
          )}
        </Button>
      </div>
    </form>
  )
}
