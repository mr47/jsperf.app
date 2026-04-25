import { Button } from '@/components/ui/button'
import CanonicalResult from './CanonicalResult'
import JITInsight from './JITInsight'
import ScalingPredictionChart from './ScalingChart'
import RuntimeComparison from './RuntimeComparison'
import { Microscope, RefreshCw, Database } from 'lucide-react'

function formatRelativeTime(value) {
  if (!value) return null
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return null
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

const STEP_META = {
  quickjs: { label: 'Running QuickJS-WASM', desc: 'Deterministic interpreter baseline' },
  v8: { label: 'Running V8 Firecracker', desc: 'Realistic JIT profiling in microVM' },
  'multi-runtime': { label: 'Comparing Node / Deno / Bun', desc: 'Cross-runtime + hardware perf counters' },
  prediction: { label: 'Building prediction model', desc: 'Scaling analysis & regression' },
}

const DEFAULT_PIPELINE = ['quickjs', 'v8', 'multi-runtime', 'prediction']

// Build the step list. The fallback includes multi-runtime so the loading
// panel doesn't reflow when the server's first pipeline event arrives.
function buildSteps(pipeline, seenMultiRuntime) {
  let keys
  if (Array.isArray(pipeline) && pipeline.length > 0) {
    keys = pipeline.filter(k => STEP_META[k])
  } else {
    keys = DEFAULT_PIPELINE
  }
  return keys.map(key => ({ key, ...STEP_META[key] }))
}

function AnalysisProgress({ progress, testCount, pipeline, seenMultiRuntime }) {
  const currentEngine = progress?.engine || 'quickjs'
  const currentStatus = progress?.status || 'running'
  const testIndex = progress?.testIndex ?? 0

  const steps = buildSteps(pipeline, seenMultiRuntime)
  const idx = steps.findIndex(s => s.key === currentEngine)
  const baseIndex = idx >= 0 ? idx : 0
  const stepIndex = currentStatus === 'done' ? baseIndex + 1 : baseIndex

  const totalSteps = steps.length
  const progressPct = (stepIndex / totalSteps) * 100

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-1.5 px-2">
          <Microscope className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-xs font-medium text-muted-foreground">
            Server Analysis
            {testCount > 1 && ` — Test ${testIndex + 1}/${testCount}`}
          </span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      <div className="rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/10 p-5">
        <div className="w-full bg-muted rounded-full h-1.5 mb-5 overflow-hidden">
          <div
            className="bg-violet-500 h-1.5 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.max(8, progressPct)}%` }}
          />
        </div>

        {progress?.runtime && (
          <p className="text-[11px] text-muted-foreground mb-3 -mt-2">
            {progress.runtime}
            {progress.profile ? ` · ${progress.profile}` : ''}
          </p>
        )}

        <div className="space-y-3">
          {steps.map((step, i) => {
            let state = 'pending'
            if (i < stepIndex) state = 'done'
            else if (i === stepIndex && currentStatus !== 'done') state = 'running'

            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {state === 'done' && (
                    <div className="h-5 w-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                      <svg className="h-3 w-3 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {state === 'running' && (
                    <div className="h-5 w-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
                  )}
                  {state === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-border/60" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className={`text-sm font-medium leading-5 ${state === 'pending' ? 'text-muted-foreground/60' : 'text-foreground'}`}>
                    {step.label}
                  </span>
                  <p className={`text-xs leading-4 ${state === 'pending' ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
                    {step.desc}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function DeepAnalysis({
  status, analysis, error, onRetry, progress, pipeline, testCount,
  multiRuntime, cachedAt,
}) {
  const mrStatus = multiRuntime?.status || 'idle'
  const mrData = multiRuntime?.data || null
  const mrError = multiRuntime?.error || null
  const seenMultiRuntime = mrStatus !== 'idle' && mrStatus !== 'unavailable'

  if (status === 'loading') {
    return (
      <AnalysisProgress
        progress={progress}
        pipeline={pipeline}
        testCount={testCount || 1}
        seenMultiRuntime={seenMultiRuntime}
      />
    )
  }

  if (status === 'error') {
    return (
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-xs font-medium text-muted-foreground px-2">Server Analysis</span>
          <div className="h-px flex-1 bg-border/60" />
        </div>
        <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (status !== 'done' || !analysis) return null

  const engineErrors = collectEngineErrors(analysis.results)
  const hasErrors = analysis.hasErrors || engineErrors.length > 0
  const errorMessage = formatEngineErrorMessage(engineErrors)

  // Merge async multi-runtime results onto the per-test base results.
  // The base results don't carry MR data anymore (it's polled separately
  // after the analyze call returns) — this stitches the two together for
  // the RuntimeComparison panel which still expects the merged shape.
  const enrichedResults = mergeMultiRuntime(analysis.results, mrData)

  const cachedLabel = formatRelativeTime(cachedAt)

  return (
    <div className="mt-8 space-y-4 animate-in fade-in duration-500">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-1.5 px-2">
          <Microscope className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-xs font-medium text-muted-foreground">Server Analysis</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {cachedLabel && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300/50 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5 text-xs">
          <Database className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground font-medium leading-tight">
              Cached snapshot from {cachedLabel} — results may be stale.
            </p>
            <p className="text-muted-foreground leading-tight mt-0.5">
              Stored from a previous run. JIT behaviour, V8 / runtime versions and worker hardware can drift over time — re-run for current numbers.
            </p>
          </div>
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 border-amber-400/50 text-amber-800 dark:text-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 shrink-0"
              onClick={onRetry}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Re-run analysis
            </Button>
          )}
        </div>
      )}

      {hasErrors && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
            {errorMessage || 'Some engines encountered errors during analysis. Results may be incomplete.'}
          </p>
        </div>
      )}

      <CanonicalResult
        results={enrichedResults}
        comparison={analysis.comparison}
      />

      <JITInsight
        results={enrichedResults}
        comparison={analysis.comparison}
      />

      <ScalingPredictionChart
        results={enrichedResults}
      />

      <MultiRuntimeSection
        results={enrichedResults}
        status={mrStatus}
        error={mrError}
      />
    </div>
  )
}

function collectEngineErrors(results) {
  if (!Array.isArray(results)) return []

  const seen = new Set()
  const errors = []
  for (const result of results) {
    for (const engine of [
      { key: 'quickjs', label: 'QuickJS-WASM' },
      { key: 'v8', label: 'V8 Firecracker' },
    ]) {
      const profile = result[engine.key]?.profiles?.find(p => p.state === 'errored')
      if (!profile) continue

      const message = profile.error || 'unknown error'
      const dedupeKey = `${engine.key}:${message}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      errors.push({
        engine: engine.key,
        label: engine.label,
        title: result.title || `Test ${result.testIndex + 1}`,
        message,
      })
    }
  }
  return errors
}

function formatEngineErrorMessage(errors) {
  if (!errors.length) return null

  const v8Errors = errors.filter(e => e.engine === 'v8')
  const quickjsErrors = errors.filter(e => e.engine === 'quickjs')
  if (quickjsErrors.length > 0 && v8Errors.length === 0) {
    const first = quickjsErrors[0]
    return `${first.label} could not run ${first.title}: ${first.message}. V8 Firecracker completed, so this is not a Vercel sandbox failure.`
  }

  const first = errors[0]
  const suffix = errors.length > 1 ? ` (${errors.length} distinct engine errors)` : ''
  return `${first.label} could not run ${first.title}: ${first.message}.${suffix}`
}

function mergeMultiRuntime(baseResults, mrData) {
  if (!Array.isArray(baseResults)) return baseResults || []
  if (!mrData?.results) return baseResults

  const byIndex = new Map(mrData.results.map(r => [r.testIndex, r]))
  return baseResults.map(r => {
    const mr = byIndex.get(r.testIndex)
    if (!mr) return r
    if (mr.state === 'done') {
      return { ...r, multiRuntime: mr.runtimes, runtimeComparison: mr.runtimeComparison }
    }
    if (mr.state === 'errored') {
      return { ...r, multiRuntimeError: mr.error || 'multi-runtime job failed' }
    }
    return r
  })
}

function MultiRuntimeSection({ results, status, error }) {
  if (status === 'idle' || status === 'unavailable') {
    // Nothing to show — either no worker configured, or worker unreachable
    // and we deliberately don't surface a panel for that. (RuntimeComparison
    // already handles the multiRuntimeError case for partial failures.)
    return <RuntimeComparison results={results} />
  }

  if (status === 'pending') {
    return (
      <div className="rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/10 p-4 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground leading-tight">
            Comparing Node / Deno / Bun
          </p>
          <p className="text-xs text-muted-foreground leading-tight">
            Running on remote worker — hardware perf counters incoming.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'errored') {
    return (
      <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 p-3">
        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
          Multi-runtime comparison unavailable: {error || 'unknown error'}
        </p>
      </div>
    )
  }

  return <RuntimeComparison results={results} />
}
