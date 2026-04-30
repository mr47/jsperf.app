import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_WORKER_POLL_DEADLINE_MS = 60_000

export function useDeepAnalysis({
  tests,
  setup,
  teardown,
  language,
  languageOptions,
  slug,
  revision,
}: {
  tests: any[]
  setup: string
  teardown: string
  language: string
  languageOptions: any
  slug: string
  revision: number
}) {
  const [analysisStatus, setAnalysisStatus] = useState('idle')
  const [analysis, setAnalysis] = useState<any>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<any>(null)
  const [analysisPipeline, setAnalysisPipeline] = useState<string[] | null>(null)
  const [analysisStepStatuses, setAnalysisStepStatuses] = useState<Record<string, string>>({})
  const [analysisCachedAt, setAnalysisCachedAt] = useState<string | null>(null)
  const [multiRuntimeStatus, setMultiRuntimeStatus] = useState('idle')
  const [multiRuntimeData, setMultiRuntimeData] = useState<any>(null)
  const [multiRuntimeError, setMultiRuntimeError] = useState<string | null>(null)
  const [runtimeTargets, setRuntimeTargets] = useState<any>(null)
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false)
  const [runtimeModalForce, setRuntimeModalForce] = useState(false)
  const multiRuntimeAbortRef = useRef<{ abort: () => void } | null>(null)

  const setAnalysisStepStatus = useCallback((engine: string, status: string) => {
    setAnalysisStepStatuses(prev => ({ ...prev, [engine]: status }))
  }, [])

  const pollMultiRuntime = useCallback(async ({ jobs, codeHash, deadlineMs, deadlineAt }: any) => {
    if (!Array.isArray(jobs) || jobs.length === 0) return

    setMultiRuntimeStatus('pending')
    setMultiRuntimeData({ results: jobs.map(j => ({ testIndex: j.testIndex, state: 'pending' })) })

    multiRuntimeAbortRef.current?.abort()
    const params = new URLSearchParams()
    params.set('jobs', jobs.map(j => `${j.testIndex}:${encodeURIComponent(j.jobId)}`).join(','))
    if (codeHash) params.set('codeHash', codeHash)
    if (deadlineAt) params.set('deadlineAt', String(deadlineAt))
    else params.set('deadlineMs', String(Number(deadlineMs) || DEFAULT_WORKER_POLL_DEADLINE_MS))

    const source = new EventSource(`/api/benchmark/multi-runtime/events?${params.toString()}`)
    multiRuntimeAbortRef.current = { abort: () => source.close() }

    const collected = new Map()
    let firstError: string | null = null
    const remaining = new Set(jobs.map(j => j.testIndex))

    const publishSnapshot = () => {
      setMultiRuntimeData({
        results: jobs.map(j =>
          collected.get(j.testIndex) || { testIndex: j.testIndex, state: 'pending' }
        ),
      })
    }

    source.addEventListener('multi-runtime', (event) => {
      const body = JSON.parse(event.data || '{}')
      if (body.state === 'done') {
        collected.set(body.testIndex, {
          testIndex: body.testIndex,
          state: 'done',
          runtimes: body.runtimes,
          runtimeComparison: body.runtimeComparison,
        })
        remaining.delete(body.testIndex)
      } else if (body.state === 'errored') {
        collected.set(body.testIndex, {
          testIndex: body.testIndex,
          state: 'errored',
          error: body.error,
        })
        if (!firstError) firstError = body.error
        remaining.delete(body.testIndex)
      } else {
        collected.set(body.testIndex, {
          testIndex: body.testIndex,
          state: body.state,
          partial: body.partial || null,
        })
      }

      publishSnapshot()
    })

    source.addEventListener('done', () => {
      source.close()
      multiRuntimeAbortRef.current = null

      if (remaining.size > 0) {
        setMultiRuntimeStatus('errored')
        setMultiRuntimeError('Multi-runtime comparison is still running on the worker. Please try again in a moment.')
        return
      }

      const allErrored = Array.from(collected.values()).every(r => r.state === 'errored')
      if (allErrored) {
        setMultiRuntimeStatus('errored')
        setMultiRuntimeError(firstError || 'All multi-runtime jobs failed')
      } else {
        setMultiRuntimeStatus('done')
      }
    })

    source.onerror = () => {
      source.close()
      multiRuntimeAbortRef.current = null
      if (remaining.size > 0) {
        setMultiRuntimeStatus('errored')
        setMultiRuntimeError('Lost connection to multi-runtime update stream.')
      }
    }
  }, [])

  const runDeepAnalysis = useCallback(async ({ force = false } = {}) => {
    setAnalysisStatus('loading')
    setAnalysisError(null)
    setAnalysisProgress(null)
    setAnalysisPipeline(null)
    setAnalysisStepStatuses({})
    setAnalysisCachedAt(null)
    setMultiRuntimeStatus('idle')
    setMultiRuntimeData(null)
    setMultiRuntimeError(null)
    multiRuntimeAbortRef.current?.abort()
    multiRuntimeAbortRef.current = null

    try {
      const analysisPayload = {
        tests: tests.map(t => ({ code: t.code, title: t.title, async: !!t.async })),
        setup,
        teardown,
        language,
        languageOptions,
        slug,
        revision,
        force,
        ...(Array.isArray(runtimeTargets) && runtimeTargets.length > 0
          ? { runtimes: runtimeTargets }
          : {}),
      }

      const start = await postJson('/api/benchmark/analyze/start', analysisPayload)
      setAnalysisPipeline(start.pipeline || null)
      setAnalysisStepStatuses(Object.fromEntries((start.pipeline || []).map((engine: string) => [engine, 'pending'])))

      const applyMultiRuntimeInfo = (info: any, codeHash: string) => {
        if (!info) return
        if (info.results) {
          setAnalysisStepStatus('multi-runtime', 'done')
          setMultiRuntimeData({ results: info.results || [] })
          setMultiRuntimeStatus('done')
        } else if (info.jobs) {
          setAnalysisStepStatus('multi-runtime', 'done')
          setMultiRuntimeStatus('pending')
          setMultiRuntimeData({
            results: (info.jobs || []).map(j => ({ testIndex: j.testIndex, state: 'pending' })),
          })
          pollMultiRuntime({
            jobs: info.jobs,
            codeHash: info.cacheKey || codeHash || null,
            deadlineMs: info.deadlineMs,
            deadlineAt: info.deadlineAt,
          })
        } else if (info.error || info.unavailable) {
          setAnalysisStepStatus('multi-runtime', info.unavailable ? 'done' : 'error')
          setMultiRuntimeStatus(info.unavailable ? 'unavailable' : 'errored')
          setMultiRuntimeError(info.error || null)
        }
      }

      setAnalysisProgress({ engine: 'complexity', testIndex: 0, status: 'running' })
      setAnalysisStepStatus('complexity', 'running')
      setAnalysisStepStatus('multi-runtime', 'running')
      const workerPromise = postJson('/api/benchmark/analyze/worker', { sessionId: start.sessionId })
        .then((data) => {
          setAnalysisProgress({ engine: 'complexity', testIndex: 0, status: 'done' })
          setAnalysisStepStatus('complexity', 'done')
          applyMultiRuntimeInfo(data.multiRuntime, start.multiRuntimeCacheKey)
          return data
        })
        .catch((err) => {
          setAnalysisStepStatus('complexity', 'error')
          setAnalysisStepStatus('multi-runtime', 'error')
          setMultiRuntimeStatus('errored')
          setMultiRuntimeError(err.message || 'Worker analysis failed')
          return { complexities: null, multiRuntime: { unavailable: true, error: err.message || 'Worker analysis failed' } }
        })

      if (start.cached && start.analysis) {
        setAnalysis(start.analysis)
        setAnalysisStatus('done')
        await workerPromise
        return
      }

      const runEngine = async (engine: string, url: string) => {
        setAnalysisProgress({ engine, testIndex: 0, status: 'running' })
        setAnalysisStepStatus(engine, 'running')
        const data = await postJson(url, { sessionId: start.sessionId })
        setAnalysisProgress({ engine, testIndex: 0, status: 'done' })
        setAnalysisStepStatus(engine, 'done')
        return data.profiles
      }

      const [quickjsProfiles, v8Profiles, worker] = await Promise.all([
        runEngine('quickjs', '/api/benchmark/analyze/quickjs'),
        runEngine('v8', '/api/benchmark/analyze/v8'),
        workerPromise,
      ])

      setAnalysisProgress({ engine: 'prediction', testIndex: 0, status: 'running' })
      setAnalysisStepStatus('prediction', 'running')
      const final = await postJson('/api/benchmark/analyze/finalize', {
        sessionId: start.sessionId,
        quickjsProfiles,
        v8Profiles,
        complexities: worker.complexities,
        multiRuntime: worker.multiRuntime,
      })
      setAnalysisProgress({ engine: 'prediction', testIndex: 0, status: 'done' })
      setAnalysisStepStatus('prediction', 'done')
      setAnalysis(final)
      setAnalysisStatus('done')
    } catch (e: any) {
      setAnalysisError(e.message || 'Failed to connect to analysis server')
      setAnalysisStatus('error')
    }
  }, [tests, setup, teardown, language, languageOptions, slug, revision, runtimeTargets, pollMultiRuntime, setAnalysisStepStatus])

  const openRuntimeAnalysisModal = useCallback((force = false) => {
    setRuntimeModalForce(force)
    setRuntimeModalOpen(true)
  }, [])

  const closeRuntimeAnalysisModal = useCallback(() => {
    if (analysisStatus === 'loading') return
    setRuntimeModalOpen(false)
  }, [analysisStatus])

  const confirmRuntimeAnalysis = useCallback(() => {
    const force = runtimeModalForce
    setRuntimeModalOpen(false)
    runDeepAnalysis({ force })
  }, [runtimeModalForce, runDeepAnalysis])

  useEffect(() => {
    return () => {
      multiRuntimeAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (analysisStatus !== 'done' || !analysis) {
      delete (window as any).__jsperfLiveAnalysis
      return
    }
    ;(window as any).__jsperfLiveAnalysis = {
      slug,
      revision,
      analysis,
      multiRuntime: multiRuntimeData || null,
      multiRuntimeStatus,
      capturedAt: Date.now(),
    }
    return () => { delete (window as any).__jsperfLiveAnalysis }
  }, [analysisStatus, analysis, multiRuntimeData, multiRuntimeStatus, slug, revision])

  useEffect(() => {
    if (!slug || revision == null) return
    let cancelled = false
    fetch(`/api/benchmark/analysis?slug=${encodeURIComponent(slug)}&revision=${encodeURIComponent(revision)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data?.analysis) return
        setAnalysisStatus(prev => (prev === 'idle' ? 'done' : prev))
        setAnalysis(prev => prev || data.analysis)
        setAnalysisCachedAt(data.createdAt || null)
        if (data.multiRuntime?.results?.length) {
          setMultiRuntimeData(prev => prev || data.multiRuntime)
          setMultiRuntimeStatus(prev => (prev === 'idle' ? 'done' : prev))
        }
      })
      .catch(() => { /* no cache, no problem */ })
    return () => { cancelled = true }
  }, [slug, revision])

  return {
    analysisStatus,
    analysis,
    analysisError,
    analysisProgress,
    analysisPipeline,
    analysisStepStatuses,
    analysisCachedAt,
    multiRuntimeStatus,
    multiRuntimeData,
    multiRuntimeError,
    runtimeTargets,
    runtimeModalOpen,
    runtimeModalForce,
    setRuntimeTargets,
    openRuntimeAnalysisModal,
    closeRuntimeAnalysisModal,
    confirmRuntimeAnalysis,
  }
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Server error (${res.status})`)
  }
  return data
}
