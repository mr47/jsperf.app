import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import AnalysisProgress from './AnalysisProgress'
import CanonicalResult from './CanonicalResult'
import JITInsight from './JITInsight'
import ScalingPredictionChart from './ScalingChart'

export default function DeepAnalysis({ tests, setup, teardown, slug, revision }) {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [progress, setProgress] = useState({ step: '', testIndex: 0 })
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState(null)

  const runAnalysis = useCallback(async () => {
    setStatus('loading')
    setError(null)
    setProgress({ step: 'quickjs', testIndex: 0 })

    try {
      const res = await fetch('/api/benchmark/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tests: tests.map(t => ({ code: t.code, title: t.title })),
          setup,
          teardown,
          slug,
          revision,
        }),
      })

      if (res.status === 429) {
        setError('Rate limited — please wait a minute before trying again.')
        setStatus('error')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Server error (${res.status})`)
        setStatus('error')
        return
      }

      const data = await res.json()

      if (res.headers.get('X-Analysis-Cache') === 'HIT') {
        setProgress({ step: 'prediction', testIndex: tests.length - 1 })
      }

      setAnalysis(data)
      setStatus('done')
    } catch (e) {
      setError(e.message || 'Failed to connect to analysis server')
      setStatus('error')
    }
  }, [tests, setup, teardown, slug, revision])

  if (status === 'idle') {
    return (
      <button
        onClick={runAnalysis}
        className="mt-4 w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors p-3 rounded-lg border border-dashed border-border/60 hover:border-border hover:bg-muted/30"
      >
        <span className="font-medium">Get reproducible results with Deep Analysis</span>
        <span className="block text-xs mt-0.5">
          Run in a controlled server environment with JIT insight and scaling prediction
        </span>
      </button>
    )
  }

  if (status === 'loading') {
    return (
      <AnalysisProgress
        currentStep={progress.step}
        testIndex={progress.testIndex}
        testCount={tests.length}
      />
    )
  }

  if (status === 'error') {
    return (
      <div className="mt-4 p-4 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={runAnalysis}
        >
          Try again
        </Button>
      </div>
    )
  }

  // status === 'done'
  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Deep Analysis
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={runAnalysis}
        >
          Re-run
        </Button>
      </div>

      <CanonicalResult
        results={analysis.results}
        comparison={analysis.comparison}
      />

      <JITInsight
        results={analysis.results}
        comparison={analysis.comparison}
      />

      <ScalingPredictionChart
        results={analysis.results}
      />
    </div>
  )
}
