import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Activity, ChevronDown, History, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react'

const STORAGE_KEY = 'jsperf.runtimeTargets.v1'

export default function RuntimeVersionSelector({ value, onChange, disabled = false, compact = true }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const appliedInitialValueRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch('/api/benchmark/runtime-tags')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Runtime tags failed (${res.status})`)
        }
        return res.json()
      })
      .then((body) => {
        if (cancelled) return
        setData(body)
        setStatus('done')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || String(err))
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (appliedInitialValueRef.current) return

    const stored = readStoredTargets()
    if (stored) {
      appliedInitialValueRef.current = true
      onChange(stored)
      return
    }

    if (data?.defaultTargets?.length) {
      appliedInitialValueRef.current = true
      onChange(data.defaultTargets)
    }
  }, [data, onChange])

  useEffect(() => {
    if (!appliedInitialValueRef.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(value) ? value : []))
    } catch (_) { /* non-fatal */ }
  }, [value])

  const selected = new Set(Array.isArray(value) ? value : [])
  const options = data?.options || []
  const optionByTarget = new Map(options.map(option => [option.target, option]))
  const selectedCount = selected.size
  const summary = selectedCount > 0
    ? summarizeSelection(value, optionByTarget)
    : 'Default Node/Deno/Bun images with perf counters'
  const isExpanded = compact ? expanded : true

  const toggleTarget = (target) => {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(target)) next.delete(target)
    else next.add(target)
    onChange([...next])
  }

  const useRecommended = () => {
    if (data?.defaultTargets?.length) onChange(data.defaultTargets)
  }
  const recommendedActive = targetsEqual(value, data?.defaultTargets || [])
  const latestActive = options.length > 0 && selectedCount === options.length && options.every(option => selected.has(option.target))
  const perfDefaultsActive = selectedCount === 0

  return (
    <div className={`w-full rounded-lg border border-border/60 bg-muted/20 ${compact ? 'px-3 py-2' : 'p-4'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5 text-violet-500" />
            Runtime versions
            {status === 'loading' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {summary}
          </p>
        </div>

        {compact && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-7 justify-between px-2 text-[11px] sm:w-auto"
            onClick={() => setExpanded(open => !open)}
            aria-expanded={expanded}
          >
            Configure
            <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        )}
      </div>

      {status === 'error' && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
          {error || 'Could not load runtime tags.'} Local worker images are still available.
        </p>
      )}

      {isExpanded && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <PresetButton
              icon={Sparkles}
              label="Recommended"
              detail="Balanced release set"
              active={recommendedActive}
              disabled={disabled || !data?.defaultTargets?.length}
              onClick={useRecommended}
            />
            <PresetButton
              icon={History}
              label="Latest + previous"
              detail="Compare regressions"
              active={latestActive}
              disabled={disabled || options.length === 0}
              onClick={() => onChange(options.map(option => option.target))}
            />
            <PresetButton
              icon={Activity}
              label="Perf defaults"
              detail="Hardware counters"
              active={perfDefaultsActive}
              disabled={disabled}
              onClick={() => onChange([])}
              title="Use the prebuilt Node/Deno/Bun images on the benchmark worker. These include linux-perf for hardware counters."
            />
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Versioned choices use Docker Hub tags for release comparisons. Perf defaults use prebuilt benchmark images and include hardware counters.
          </p>

          {options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {options.map((option) => {
                const checked = selected.has(option.target)
                return (
                  <button
                    key={option.target}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleTarget(option.target)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      checked
                        ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                        : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground'
                    } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    title={option.detail}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="ml-1 text-[10px] opacity-70">{option.kind}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PresetButton({ icon: Icon, label, detail, active, disabled, onClick, title = undefined }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`group relative overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${
        active
          ? 'border-violet-500/50 bg-violet-500/10 text-foreground shadow-sm shadow-violet-500/10'
          : 'border-border/70 bg-background/60 text-muted-foreground hover:-translate-y-0.5 hover:border-violet-400/40 hover:bg-violet-500/5 hover:text-foreground'
      } ${disabled ? 'cursor-not-allowed opacity-60 hover:translate-y-0' : ''}`}
    >
      <span className="pointer-events-none absolute -right-8 -top-8 h-16 w-16 rounded-full bg-violet-500/10 blur-2xl transition-transform duration-300 group-hover:scale-125" />
      <span className="relative flex items-start gap-2.5">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          active
            ? 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300'
            : 'border-border/70 bg-muted/40 text-muted-foreground group-hover:text-violet-600 dark:group-hover:text-violet-300'
        }`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold leading-tight">{label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug opacity-75">{detail}</span>
        </span>
      </span>
    </button>
  )
}

function summarizeSelection(targets, optionByTarget) {
  const labels = (Array.isArray(targets) ? targets : [])
    .map(target => optionByTarget.get(target)?.label || target)

  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
}

function targetsEqual(a, b) {
  const left = Array.isArray(a) ? [...a].sort() : []
  const right = Array.isArray(b) ? [...b].sort() : []
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function readStoredTargets() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : null
  } catch (_) {
    return null
  }
}
