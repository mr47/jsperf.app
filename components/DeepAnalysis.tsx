import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import CanonicalResult from './CanonicalResult'
import JITInsight from './JITInsight'
import ComplexityInsight from './ComplexityInsight'
import ScalingPredictionChart from './ScalingChart'
import RuntimeComparison from './RuntimeComparison'
import CompatibilityMatrix from './CompatibilityMatrix'
import BenchmarkDoctor from './BenchmarkDoctor'
import { Cpu, Download, ExternalLink, Microscope, RefreshCw, Database } from 'lucide-react'
import { buildBenchmarkDoctor } from '../lib/benchmark/doctor'

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
  'quickjs-worker': { label: 'Running worker-side QuickJS-WASM', desc: 'Donor worker handles QuickJS profiles, complexity, and runtime jobs' },
  v8: { label: 'Running V8 Firecracker', desc: 'Realistic JIT profiling in microVM' },
  'multi-runtime': { label: 'Running Node / Deno / Bun', desc: 'Compares the same tests across server runtimes' },
  'jit-artifacts': { label: 'Capturing JIT output', desc: 'Stores V8 optimized-code and assembly artifacts for Node / Deno' },
  complexity: { label: 'Estimating complexity', desc: 'Checks time, space, and async behavior from the code shape' },
  prediction: { label: 'Building prediction model', desc: 'JIT amplification and memory-response analysis' },
}

const DEFAULT_PIPELINE = ['quickjs', 'v8', 'multi-runtime', 'complexity', 'prediction']

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

function AnalysisProgress({ progress, testCount, pipeline, seenMultiRuntime, stepStatuses }) {
  const currentEngine = progress?.engine || 'quickjs'
  const currentStatus = progress?.status || 'running'
  const testIndex = progress?.testIndex ?? 0
  const maxProgressPctRef = useRef(0)

  const steps = buildSteps(pipeline, seenMultiRuntime)
  const totalSteps = steps.length
  const hasStepStatuses = stepStatuses && Object.keys(stepStatuses).length > 0
  if (!progress && !hasStepStatuses) maxProgressPctRef.current = 0
  const fallbackIdx = steps.findIndex(s => s.key === currentEngine)
  const fallbackStepIndex = currentStatus === 'done' ? fallbackIdx + 1 : Math.max(0, fallbackIdx)
  const doneCount = hasStepStatuses
    ? steps.filter(step => stepStatuses[step.key] === 'done').length
    : fallbackStepIndex
  const runningCount = hasStepStatuses
    ? steps.filter(step => stepStatuses[step.key] === 'running').length
    : currentStatus === 'running' ? 1 : 0
  const heartbeatTick = Number(progress?.heartbeat) || 0
  const runningStepCredit = runningCount > 0
    ? runningCount * Math.min(0.85, 0.18 + heartbeatTick * 0.08)
    : 0
  const progressPct = Math.min(100, ((doneCount + runningStepCredit) / totalSteps) * 100)
  maxProgressPctRef.current = Math.max(maxProgressPctRef.current, progressPct)
  const visibleProgressPct = Math.max(runningCount > 0 ? 8 : 0, maxProgressPctRef.current)
  const currentStepLabel = STEP_META[currentEngine]?.label
  const showPerTest = progress?.perTest && testCount > 1
  const displayTestNumber = Math.min(testCount, Math.max(1, testIndex + 1))

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-1.5 px-2">
          <Microscope className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-xs font-medium text-muted-foreground">
            Deep Analysis Orchestration
            {showPerTest && ` — ${currentStepLabel || 'Current engine'}: test ${displayTestNumber}/${testCount}`}
          </span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      <div className="rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/10 p-5">
        <div className="w-full bg-muted rounded-full h-1.5 mb-5 overflow-hidden">
          <div
            className="bg-violet-500 h-1.5 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${visibleProgressPct}%` }}
          />
        </div>

        <p className="text-xs text-muted-foreground mb-4 -mt-2">
          Updates refresh about every 2 seconds while longer checks are running.
        </p>

        {progress?.runtime && (
          <p className="text-[11px] text-muted-foreground mb-3 -mt-2">
            {progress.runtime}
            {progress.profile ? ` · ${progress.profile}` : ''}
          </p>
        )}

        <div className="space-y-3">
          {steps.map((step, i) => {
            let state = stepStatuses?.[step.key] || 'pending'
            if (!hasStepStatuses) {
              state = 'pending'
              if (i < fallbackStepIndex) state = 'done'
              else if (i === fallbackStepIndex && currentStatus !== 'done') state = 'running'
            }

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
                  {state === 'error' && (
                    <div className="h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-[11px] font-bold text-amber-700 dark:text-amber-300">
                      !
                    </div>
                  )}
                  {state === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-border/60" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className={`text-sm font-medium leading-5 ${state === 'pending' ? 'text-muted-foreground/60' : state === 'error' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
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
  status, analysis, error, onRetry, onJitCaptureRequest, progress, pipeline, stepStatuses, testCount,
  multiRuntime, cachedAt, stats, tests, setup, teardown, showCompatibilityMatrix = false, jitCaptureRequested = false,
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
        stepStatuses={stepStatuses}
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
  const hasErrors = analysis.hasErrors || engineErrors.some(e => e.severity === 'error')
  const errorMessage = formatEngineErrorMessage(engineErrors)

  // Merge async multi-runtime results onto the per-test base results.
  // The base results don't carry MR data anymore (it's polled separately
  // after the analyze call returns) — this stitches the two together for
  // the RuntimeComparison panel which still expects the merged shape.
  const enrichedResults = mergeMultiRuntime(analysis.results, mrData)

  const cachedLabel = formatRelativeTime(cachedAt)
  const sourcePrepLabel = formatSourcePrepMeta(analysis.meta)
  const doctor = analysis.doctor || buildBenchmarkDoctor({
    tests: tests || [],
    setup: setup || '',
    teardown: teardown || '',
    results: analysis.results || [],
  })

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

      {sourcePrepLabel && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {sourcePrepLabel}
        </div>
      )}

      {hasErrors && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
            {errorMessage || 'Some engines encountered errors during analysis. Results may be incomplete.'}
          </p>
        </div>
      )}

      <BenchmarkDoctor doctor={doctor} />

      {showCompatibilityMatrix && (
        <CompatibilityMatrix
          results={enrichedResults}
          browserStats={stats}
          multiRuntime={{ status: mrStatus, error: mrError }}
        />
      )}

      <CanonicalResult
        results={enrichedResults}
        comparison={analysis.comparison}
      />

      <JITInsight
        results={enrichedResults}
        comparison={analysis.comparison}
      />

      <ComplexityInsight
        results={enrichedResults}
      />

      <ScalingPredictionChart
        results={enrichedResults}
      />

      <MultiRuntimeSection
        results={enrichedResults}
        status={mrStatus}
        error={mrError}
      />

      <JitArtifactsSection
        results={enrichedResults}
        onCaptureRequest={onJitCaptureRequest}
        captureRequested={jitCaptureRequested}
      />
    </div>
  )
}

function formatSourcePrepMeta(meta) {
  if (!meta || meta.language !== 'typescript') return null
  const ms = typeof meta.sourcePrepMs === 'number' ? `${meta.sourcePrepMs}ms` : null
  const compiler = meta.compiler?.version ? `TypeScript ${meta.compiler.version}` : 'TypeScript'
  const target = meta.languageOptions?.target ? `target ${meta.languageOptions.target.toUpperCase()}` : null
  const mode = meta.languageOptions?.runtimeMode === 'compiled-everywhere'
    ? 'compiled for all runtimes'
    : 'native TypeScript on Deno/Bun'
  return [
    `${compiler} prepared benchmark source`,
    ms ? `in ${ms}` : null,
    target ? `(${target}, ${mode})` : `(${mode})`,
  ].filter(Boolean).join(' ')
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
      if (engine.key === 'quickjs' && result.v8?.opsPerSec > 0) continue

      const message = profile.error || 'unknown error'
      const dedupeKey = `${engine.key}:${message}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      errors.push({
        engine: engine.key,
        label: engine.label,
        title: result.title || `Test ${result.testIndex + 1}`,
        message,
        severity: 'error',
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

  const byIndex = new Map<number, any>(mrData.results.map((r: any) => [r.testIndex, r]))
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

function collectJitArtifactEntries(results) {
  if (!Array.isArray(results)) return []
  const entries = []
  for (const result of results) {
    const comparison = result.runtimeComparison
    if (!comparison?.available || !Array.isArray(comparison.runtimes)) continue
    for (const runtimeData of comparison.runtimes) {
      const profile = runtimeData.profiles?.[0] || {}
      if (!profile.jitArtifactRef && !profile.jitArtifactError) continue
      entries.push({
        testIndex: result.testIndex,
        title: result.title || `Test ${Number(result.testIndex) + 1}`,
        runtime: runtimeData.runtime,
        runtimeLabel: runtimeData.label || runtimeData.runtime || 'Runtime',
        ref: profile.jitArtifactRef || null,
        error: profile.jitArtifactError || null,
      })
    }
  }
  return entries
}

function hasNodeOrDenoRuntime(results) {
  if (!Array.isArray(results)) return false
  return results.some(result => {
    const runtimes = result.runtimeComparison?.runtimes
    return Array.isArray(runtimes) && runtimes.some(runtimeData => {
      const runtime = String(runtimeData.runtime || runtimeData.runtimeName || '').toLowerCase()
      return runtime.startsWith('node') || runtime.startsWith('deno')
    })
  })
}

function formatBytes(n) {
  if (n == null) return '0B'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function formatBig(n) {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
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
            Streaming Node / Deno / Bun updates
          </p>
          <p className="text-xs text-muted-foreground leading-tight">
            Base QuickJS/V8 results are ready. This panel stays subscribed to worker updates through SSE until each runtime comparison finishes.
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

function JitArtifactsSection({ results, onCaptureRequest, captureRequested }) {
  const entries = collectJitArtifactEntries(results)
  const hasV8Runtime = hasNodeOrDenoRuntime(results)

  if (!hasV8Runtime && entries.length === 0) return null

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-5 shadow-sm">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Cpu className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-500" />
          <div>
            <h3 className="text-base font-semibold text-foreground">JIT output artifacts</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              V8 optimization trace and generated assembly captured as a separate Deep Analysis artifact.
            </p>
          </div>
        </div>
        {onCaptureRequest && entries.length === 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-sky-500/40 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300"
            onClick={onCaptureRequest}
          >
            <Cpu className="h-3.5 w-3.5" />
            Run JIT capture
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-border/50 bg-background/70 p-3 text-xs text-muted-foreground">
          {captureRequested
            ? 'JIT capture was requested, but the worker did not return a JIT artifact. Redeploy or restart the benchmark worker with the updated capture code, then run JIT capture again.'
            : 'No JIT artifact is attached to the current result. Run JIT capture to generate public viewer links for Node.js and Deno.'}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={`${entry.testIndex}:${entry.runtime}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
              <div className="min-w-0 text-xs">
                <span className="font-semibold text-foreground">{entry.title}</span>
                <span className="ml-2 text-muted-foreground">{entry.runtimeLabel}</span>
                {entry.ref && (
                  <span className="ml-2 text-muted-foreground">
                    {formatBig(entry.ref.lineCount || 0)} lines · {formatBytes(entry.ref.sizeBytes || 0)}
                    {entry.ref.truncated ? ' · truncated' : ''}
                  </span>
                )}
                {entry.error && (
                  <span className="ml-2 text-red-600 dark:text-red-400">{entry.error}</span>
                )}
              </div>
              {entry.ref && (
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="xs">
                    <a href={`/jit/${entry.ref.id}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      Viewer
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="xs">
                    <a href={`/api/benchmark/jit-artifact/${entry.ref.id}?download=1`}>
                      <Download className="h-3 w-3" />
                      .txt
                    </a>
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
