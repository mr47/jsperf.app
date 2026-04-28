/**
 * "Generate report" CTA + result modal for a single benchmark
 * revision. Donor-gated server-side; this component just relays the
 * outcome to the user:
 *
 *   - 201: show success card with copy / open / dismiss actions.
 *   - 402: pop a friendly explainer and open the donor flow.
 *   - 4xx/5xx: surface the message returned by the API.
 *
 * The button itself is always visible — gating in the UI is gentler
 * than gating in the server, so non-donors can discover the feature
 * and learn that supporting unlocks it.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Presentation,
  Sparkles,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  X,
  Heart,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GenerateReportButton({ slug, revision, className = '' }) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('idle')          // idle | loading | success | needsDonor | error
  const [report, setReport] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') closeDialog() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function closeDialog() {
    setOpen(false)
    // Reset transient state shortly after — keeps the closing
    // animation from showing the wrong state for a frame.
    setTimeout(() => {
      setStatus('idle')
      setErrorMsg('')
      setCopied(false)
    }, 120)
  }

  async function generate() {
    setStatus('loading')
    setErrorMsg('')
    try {
      // If the user just ran deep analysis, TestRunner will have
      // stashed the merged client-side snapshot (analysis + polled
      // multi-runtime results) on window. Forward it so the report
      // can include data the server-side analysis cache doesn't have
      // (multi-runtime + perf counters live only on the client).
      const live = typeof window !== 'undefined' ? window.__jsperfLiveAnalysis : null
      const matchesPage = live && String(live.slug) === String(slug) && Number(live.revision) === Number(revision)
      const body: any = { slug, revision }
      if (matchesPage) {
        body.clientAnalysis = live.analysis
        body.clientMultiRuntime = live.multiRuntime
      }
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 402) {
        setStatus('needsDonor')
        setErrorMsg(data?.message || 'Donor required.')
        return
      }
      if (!res.ok) {
        setStatus('error')
        setErrorMsg(data?.error || data?.message || `Failed (${res.status}).`)
        return
      }
      setReport(data)
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err?.message || 'Network error.')
    }
  }

  function openAndGenerate() {
    setOpen(true)
    // Defer so the modal can paint its loading state before we hit
    // the network — avoids the "click does nothing" feeling on slow
    // connections.
    setTimeout(generate, 30)
  }

  function openDonorModal() {
    // The DonorBoost component (mounted in the header) listens for
    // this event and opens itself.
    window.dispatchEvent(new CustomEvent('jsperf:open-donor-modal'))
    closeDialog()
  }

  async function copyLink() {
    if (!report?.url) return
    const absolute = `${window.location.origin}${report.url}`
    try {
      await navigator.clipboard.writeText(absolute)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) { /* ignored */ }
  }

  return (
    <>
      <button
        type="button"
        onClick={openAndGenerate}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring border border-input bg-background shadow-sm hover:bg-muted hover:text-accent-foreground h-9 px-4 py-2 gap-2 ${className}`}
      >
        <Presentation className="w-4 h-4 text-violet-600" />
        Generate report
      </button>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeDialog() }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gen-report-title"
            className="w-full sm:max-w-lg bg-background border-t sm:border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <h2 id="gen-report-title" className="font-semibold text-sm">Presentation report</h2>
              </div>
              <button
                onClick={closeDialog}
                className="rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6">
              {status === 'loading' && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                  <p className="text-sm text-muted-foreground">Snapshotting benchmark and building slides…</p>
                </div>
              )}

              {status === 'success' && report && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">Your report is ready</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A frozen snapshot of this benchmark, packaged as a slide deck with runtime, JIT,
                      memory, and complexity readouts. The link works for anyone you share it with — no sign-in required to view.
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
                    {typeof window !== 'undefined' ? `${window.location.origin}${report.url}` : report.url}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={report.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold h-9 px-3"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open in new tab
                    </a>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border bg-background hover:bg-muted text-sm font-semibold h-9 px-3"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </div>
              )}

              {status === 'needsDonor' && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-rose-100 dark:bg-rose-900/40 p-2 text-rose-600 dark:text-rose-300">
                      <Heart className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold tracking-tight">Donor perk</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Generating shareable presentation reports is reserved for jsPerf supporters.
                        Donations keep the V8 / QuickJS / multi-runtime pipelines, complexity slides, and AI analyses running.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={openDonorModal} className="gap-1.5">
                      <Heart className="h-4 w-4" />
                      Become a supporter
                    </Button>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="inline-flex items-center justify-center rounded-md border bg-background hover:bg-muted text-sm font-semibold h-9 px-3"
                    >
                      Maybe later
                    </button>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">Something went wrong</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{errorMsg || 'Please try again.'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={generate}>Try again</Button>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="inline-flex items-center justify-center rounded-md border bg-background hover:bg-muted text-sm font-semibold h-9 px-3"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
