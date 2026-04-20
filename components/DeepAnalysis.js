import { Button } from '@/components/ui/button'
import CanonicalResult from './CanonicalResult'
import JITInsight from './JITInsight'
import ScalingPredictionChart from './ScalingChart'
import RuntimeComparison from './RuntimeComparison'
import { Microscope } from 'lucide-react'

const STEP_META = {
  quickjs: { label: 'Running QuickJS-WASM', desc: 'Deterministic interpreter baseline' },
  v8: { label: 'Running V8 Firecracker', desc: 'Realistic JIT profiling in microVM' },
  'multi-runtime': { label: 'Comparing Node / Deno / Bun', desc: 'Cross-runtime + hardware perf counters' },
  prediction: { label: 'Building prediction model', desc: 'Scaling analysis & regression' },
}

const DEFAULT_PIPELINE = ['quickjs', 'v8', 'prediction']

// Build the step list. Prefer the explicit pipeline the server announces
// at the start of streaming (so we can render all four steps from t=0,
// including multi-runtime). If the server hasn't told us yet, fall back
// to the legacy "detect when we see the engine in a progress event" path
// so older API responses still render reasonably.
function buildSteps(pipeline, seenMultiRuntime) {
  let keys
  if (Array.isArray(pipeline) && pipeline.length > 0) {
    keys = pipeline.filter(k => STEP_META[k])
  } else {
    keys = seenMultiRuntime
      ? ['quickjs', 'v8', 'multi-runtime', 'prediction']
      : DEFAULT_PIPELINE
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
  multiRuntime,
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

  const hasErrors = analysis.hasErrors ||
    analysis.results?.some(r =>
      r.v8?.profiles?.some(p => p.state === 'errored') ||
      r.quickjs?.profiles?.some(p => p.state === 'errored')
    )

  // Merge async multi-runtime results onto the per-test base results.
  // The base results don't carry MR data anymore (it's polled separately
  // after the analyze call returns) — this stitches the two together for
  // the RuntimeComparison panel which still expects the merged shape.
  const enrichedResults = mergeMultiRuntime(analysis.results, mrData)

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

      {hasErrors && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Some engines encountered errors during analysis. Results may be incomplete.
            Try re-running from the toolbar.
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
