import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { signIn, useSession } from 'next-auth/react'
import { Coffee, Sparkles, X, Loader2, Zap, Heart, Check, Presentation } from 'lucide-react'
import GitHubIcon from './GitHubIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DONATELLO_URL = 'https://donatello.to/mr47'

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
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [donor, setDonor] = useState(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [mounted, setMounted] = useState(false)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
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
      .then(data => { if (!cancelled) setDonor(data?.donor || null) })
      .catch(() => { if (!cancelled) setDonor(null) })
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

  const handleSignOut = async () => {
    try { await fetch('/api/donor/me', { method: 'DELETE' }) } catch (_) { /* ignore */ }
    setDonor(null)
    setSuccess(null)
    setError(null)
  }

  const isDonor = !!donor
  const signedIn = !!session?.user

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
        isDonor
          ? 'text-amber-600 dark:text-amber-400 hover:text-amber-500'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      {isDonor ? (
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
          onSignIn={() => signIn('github')}
          onSignOut={handleSignOut}
          onSubmitVerify={handleVerify}
          name={name}
          code={code}
          setName={setName}
          setCode={setCode}
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
    onClose, onSignIn, onSignOut, onSubmitVerify,
    name, code, setName, setCode, nameInputRef,
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
        className="relative w-full sm:w-auto sm:max-w-2xl sm:mx-4 max-h-[92vh] overflow-y-auto
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

function PerkRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="shrink-0 w-8 h-8 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
      </div>
      <div className="text-sm tabular-nums font-semibold text-foreground whitespace-nowrap">{value}</div>
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
        <div className="divide-y divide-border/50">
          <PerkRow icon={Zap} label="Save / load benchmark" value="120 / min" />
          <PerkRow icon={Zap} label="Submit benchmark runs" value="120 / min" />
          <PerkRow icon={Zap} label="Deep analysis" value="5 / min" />
          <PerkRow icon={Presentation} label="Presentation reports" value="Unlocked" />
        </div>
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
            {donor?.via === 'email' ? 'GitHub email' : 'Donation code'}
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

function ClaimView({ signedIn, onSignIn, onShowForm, success }) {
  return (
    <div className="space-y-6">
      {/* Perks card */}
      <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          What you get for any donation
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Perk label="Save / load" detail="120 / min" sub="up from 30" />
          <Perk label="Run submissions" detail="120 / min" sub="up from 30" />
          <Perk label="Deep analysis" detail="5 / min" sub="up from 1" />
          <Perk label="Reports" detail="Unlocked" sub="shareable slide deck" />
        </div>
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

function Perk({ label, detail, sub }) {
  return (
    <div className="rounded-lg bg-background border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold mt-0.5 tabular-nums">{detail}</div>
      <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>
    </div>
  )
}

function Path({ step, title, description, action, done }) {
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
