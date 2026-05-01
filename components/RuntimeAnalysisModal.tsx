import { useEffect } from 'react'
import { ArrowRight, Cpu, Flame, Loader2, LockKeyhole, Microscope, Sparkles, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import RuntimeVersionSelector from './RuntimeVersionSelector'

export default function RuntimeAnalysisModal({
  open,
  force,
  loading,
  isDonor,
  runtimeTargets,
  onRuntimeTargetsChange,
  workerSideQuickJS,
  onWorkerSideQuickJSChange,
  nodeCpuProfiling,
  onNodeCpuProfilingChange,
  onClose,
  onConfirm,
}: {
  open: boolean
  force: boolean
  loading: boolean
  isDonor: boolean
  runtimeTargets: any
  onRuntimeTargetsChange: (value: any) => void
  workerSideQuickJS: boolean
  onWorkerSideQuickJSChange: (value: boolean) => void
  nodeCpuProfiling: boolean
  onNodeCpuProfilingChange: (value: boolean) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const openDonorModal = () => {
    onClose()
    window.dispatchEvent(new CustomEvent('jsperf:open-donor-modal'))
  }

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="runtime-analysis-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-5">
          <div>
            <h2 id="runtime-analysis-title" className="text-lg font-semibold text-foreground">
              {force ? 'Re-run deep analysis' : 'Deep analysis setup'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose runtime versions. Donors use the priority worker lane by default.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5">
          {isDonor && (
            <label className="group relative mb-5 block cursor-pointer overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-violet-500/10 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-400/70 hover:shadow-lg hover:shadow-amber-500/10">
              <span className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-amber-400/20 blur-3xl transition-transform duration-500 group-hover:scale-125" />
              <span className="pointer-events-none absolute -bottom-16 left-12 h-32 w-32 rounded-full bg-violet-500/15 blur-3xl" />
              <input
                type="checkbox"
                checked={workerSideQuickJS}
                onChange={(event) => onWorkerSideQuickJSChange(event.target.checked)}
                disabled={loading}
                className="peer sr-only"
              />
              <span className="relative flex flex-col gap-4 rounded-xl outline-none transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500/50 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-background/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 shadow-sm dark:text-amber-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Donor fast lane
                  </span>
                  <span className="mt-3 block text-base font-semibold text-foreground">
                    Priority worker lane is ready
                  </span>
                  <span className="mt-1.5 block max-w-xl text-xs leading-relaxed text-muted-foreground">
                    QuickJS-WASM profiles, complexity checks, and runtime job enqueueing leave the app path and run on the donor worker lane. V8 Firecracker still runs on Vercel Sandbox for the canonical JIT read.
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-2 py-1">
                      <Zap className="h-3 w-3 text-amber-500" />
                      QuickJS-WASM
                    </span>
                    <ArrowRight className="h-3 w-3 text-amber-500/70" />
                    <span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-2 py-1">
                      <Cpu className="h-3 w-3 text-violet-500" />
                      Worker queue
                    </span>
                    <ArrowRight className="h-3 w-3 text-violet-500/70" />
                    <span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-2 py-1">
                      <Microscope className="h-3 w-3 text-sky-500" />
                      V8 Sandbox
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-right text-[11px] font-medium text-muted-foreground sm:block">
                    <span className="block text-foreground">
                      {workerSideQuickJS ? 'Default on' : 'Legacy route'}
                    </span>
                    <span className="block">click to switch</span>
                  </span>
                  <span
                    className={`relative h-8 w-14 rounded-full border transition-colors duration-300 ${
                      workerSideQuickJS
                        ? 'border-amber-400/60 bg-amber-500/25'
                        : 'border-border bg-muted'
                    }`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute left-1 top-1 h-6 w-6 rounded-full shadow-md transition-transform duration-300 ${
                        workerSideQuickJS
                          ? 'translate-x-6 bg-amber-400'
                          : 'translate-x-0 bg-background'
                      }`}
                    />
                    <span
                      className={`absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-amber-400 transition-opacity duration-300 ${
                        workerSideQuickJS ? 'opacity-100 animate-pulse' : 'opacity-0'
                      }`}
                    />
                  </span>
                </span>
              </span>
            </label>
          )}
          {!isDonor && (
            <div className="relative mb-5 overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-background to-amber-500/10 p-4 shadow-sm">
              <div className="pointer-events-none absolute -right-10 top-2 h-28 w-28 rounded-full bg-violet-500/20 blur-3xl" />
              <div className="relative grid gap-4 sm:grid-cols-[1fr_0.9fr] sm:items-center">
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-background/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                    <LockKeyhole className="h-3.5 w-3.5" />
                    Donor priority lane
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-foreground">
                    The heavy checks get their own worker lane
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Free runs still get Deep Analysis. Donors move QuickJS-WASM, complexity, and runtime job enqueueing out of the public app path, which is especially useful for larger benchmarks and back-to-back tuning.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 border-violet-500/30 bg-background/60 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
                    onClick={openDonorModal}
                    disabled={loading}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Unlock donor priority
                  </Button>
                </div>

                <div className="rounded-xl border bg-background/65 p-3 shadow-inner">
                  <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Public path</span>
                    <span>Priority lane</span>
                  </div>
                  <div className="space-y-2">
                    <div className="relative h-8 overflow-hidden rounded-full bg-muted">
                      <span className="absolute left-2 top-1/2 h-2 w-12 -translate-y-1/2 rounded-full bg-muted-foreground/25" />
                      <span className="absolute left-20 top-1/2 h-2 w-10 -translate-y-1/2 rounded-full bg-muted-foreground/20" />
                      <span className="absolute right-3 top-1/2 h-2 w-8 -translate-y-1/2 rounded-full bg-muted-foreground/15" />
                    </div>
                    <div className="relative h-8 overflow-hidden rounded-full border border-amber-400/40 bg-amber-500/10">
                      <span className="absolute left-2 top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 rounded-full bg-amber-400 px-2 text-[10px] font-bold text-amber-950 shadow-sm animate-pulse">
                        <Zap className="h-3 w-3" />
                        QuickJS
                      </span>
                      <span className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.8)]" />
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    Less waiting on app-side analysis, more time comparing the results that matter.
                  </p>
                </div>
              </div>
            </div>
          )}
          <RuntimeVersionSelector
            value={runtimeTargets}
            onChange={onRuntimeTargetsChange}
            disabled={loading}
            compact={false}
          />
          <label className="mt-5 block cursor-pointer rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 transition-colors hover:bg-orange-500/10">
            <span className="flex gap-3">
              <input
                type="checkbox"
                checked={nodeCpuProfiling}
                onChange={(event) => onNodeCpuProfilingChange(event.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4 rounded border-border"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Flame className="h-4 w-4 text-orange-500" />
                  Capture Node CPU profile
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Stores a Chrome DevTools / CPUpro compatible `.cpuprofile` for Node.js runtime runs. This is opt-in because profiles can be large.
                </span>
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border/60 p-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="font-bold"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Microscope className="h-4 w-4" />
            )}
            {loading ? 'Starting...' : force ? 'Re-run analysis' : 'Start analysis'}
          </Button>
        </div>
      </div>
    </div>
  )
}
