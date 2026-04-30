import { useEffect } from 'react'
import { Loader2, Microscope, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import RuntimeVersionSelector from './RuntimeVersionSelector'

export default function RuntimeAnalysisModal({
  open,
  force,
  loading,
  runtimeTargets,
  onRuntimeTargetsChange,
  onClose,
  onConfirm,
}: {
  open: boolean
  force: boolean
  loading: boolean
  runtimeTargets: any
  onRuntimeTargetsChange: (value: any) => void
  onClose: () => void
  onConfirm: () => void
}) {
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
              Choose which Node, Deno, and Bun versions the container worker should benchmark.
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
          <RuntimeVersionSelector
            value={runtimeTargets}
            onChange={onRuntimeTargetsChange}
            disabled={loading}
            compact={false}
          />
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
