import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_WORKER_POLL_DEADLINE_MS = 60_000
const WORKER_STREAM_GRACE_MS = 30_000
const WORKER_STREAM_RECONNECT_BASE_MS = 1500
const WORKER_STREAM_RECONNECT_MAX_MS = 2000
const ANALYSIS_PROGRESS_HEARTBEAT_MS = 2000

export function useDeepAnalysis({
  tests,
  setup,
  teardown,
  language,
  languageOptions,
  slug,
  revision,
  isDonor = false,
}: {
  tests: any[]
  setup: string
  teardown: string
  language: string
  languageOptions: any
  slug: string
  revision: number
  isDonor?: boolean
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
  const [workerSideQuickJS, setWorkerSideQuickJS] = useState(false)
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false)
  const [runtimeModalForce, setRuntimeModalForce] = useState(false)
  const multiRuntimeAbortRef = useRef<{ abort: () => void } | null>(null)

  const setAnalysisStepStatus = useCallback((engine: string, status: string) => {
    setAnalysisStepStatuses(prev => {
      if (prev[engine] === status) return prev
      if (prev[engine] === 'done' && status !== 'done') return prev
      return { ...prev, [engine]: status }
    })
  }, [])

  const publishAnalysisProgress = useCallback((next: any) => {
    setAnalysisProgress(prev => {
      if (!next) return next
      const nextProgress = typeof next === 'function' ? next(prev) : next
      if (!nextProgress) return nextProgress
      return {
        ...nextProgress,
        heartbeat: Number(nextProgress.heartbeat ?? prev?.heartbeat ?? 0),
        tick: nextProgress.tick ?? prev?.tick,
      }
    })
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

    const collected = new Map()
    let firstError: string | null = null
    const remaining = new Set(jobs.map(j => j.testIndex))
    const workerDeadlineAt = Number(deadlineAt) || (
      Date.now() + (Number(deadlineMs) || DEFAULT_WORKER_POLL_DEADLINE_MS)
    )
    const reconnectUntil = workerDeadlineAt + WORKER_STREAM_GRACE_MS
    const streamUrl = `/api/benchmark/multi-runtime/events?${params.toString()}`
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    let stopped = false

    const publishSnapshot = () => {
      setMultiRuntimeData({
        results: jobs.map(j =>
          collected.get(j.testIndex) || { testIndex: j.testIndex, state: 'pending' }
        ),
      })
    }

    const stopStream = () => {
      stopped = true
      source?.close()
      source = null
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    multiRuntimeAbortRef.current = { abort: stopStream }

    const finishStream = () => {
      stopStream()
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
        setMultiRuntimeError(null)
      }
    }

    const scheduleReconnect = () => {
      if (stopped || remaining.size === 0) {
        finishStream()
        return
      }
      if (Date.now() >= reconnectUntil) {
        finishStream()
        return
      }

      reconnectAttempts += 1
      const delay = Math.min(
        WORKER_STREAM_RECONNECT_MAX_MS,
        WORKER_STREAM_RECONNECT_BASE_MS * reconnectAttempts,
      )
      reconnectTimer = setTimeout(openStream, delay)
    }

    const handleUpdate = (event: MessageEvent) => {
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
    }

    function openStream() {
      if (stopped || remaining.size === 0) return
      source = new EventSource(streamUrl)
      reconnectTimer = null
      setMultiRuntimeStatus('pending')

      source.addEventListener('multi-runtime', handleUpdate)
      source.addEventListener('done', () => {
        source?.close()
        source = null
        reconnectAttempts = 0
        if (remaining.size > 0 && Date.now() < reconnectUntil) {
          scheduleReconnect()
          return
        }
        finishStream()
      })

      source.onerror = () => {
        source?.close()
        source = null
        if (remaining.size > 0) {
          scheduleReconnect()
        }
      }
    }

    openStream()
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
        ...(isDonor && workerSideQuickJS
          ? { workerExecutionMode: 'quickjs-composite' }
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

      const runDonorAnalysisJob = async () => {
        let jobId: string | null = null
        let lastMultiRuntimeKey: string | null = null
        const usesWorkerQuickJS = start.workerExecutionMode === 'quickjs-composite'

        if (usesWorkerQuickJS) {
          setAnalysisStepStatus('quickjs-worker', 'running')
          publishAnalysisProgress({
            engine: 'quickjs-worker',
            testIndex: 0,
            perTest: false,
            status: 'running',
          })
        }

        while (true) {
          const data = await postJson('/api/benchmark/analyze/donor-job', {
            sessionId: start.sessionId,
            jobId,
          })
          jobId = data.jobId

          const progress = data.progress || {}
          const total = Number(progress.total) || tests.length
          const quickjsDone = Number(progress.quickjsDone) || 0
          const v8Done = Number(progress.v8Done) || 0

          if (usesWorkerQuickJS) {
            setAnalysisStepStatus('quickjs-worker', progress.workerStarted ? 'done' : 'running')
          }

          if (progress.workerStarted) {
            setAnalysisStepStatus('complexity', 'done')
            if (!data.multiRuntime) {
              setAnalysisStepStatus('multi-runtime', 'done')
            }
          } else {
            setAnalysisStepStatus('complexity', 'running')
            setAnalysisStepStatus('multi-runtime', 'running')
          }

          if (!usesWorkerQuickJS) {
            setAnalysisStepStatus('quickjs', quickjsDone >= total ? 'done' : data.phase === 'quickjs' ? 'running' : 'pending')
          }
          setAnalysisStepStatus('v8', v8Done >= total ? 'done' : data.phase === 'v8' ? 'running' : 'pending')
          setAnalysisStepStatus('prediction', data.phase === 'prediction' ? 'running' : data.status === 'done' ? 'done' : 'pending')
          const progressEngine = usesWorkerQuickJS && !progress.workerStarted
            ? 'quickjs-worker'
            : data.phase
          publishAnalysisProgress({
            engine: progressEngine,
            testIndex: data.phase === 'v8' ? v8Done : quickjsDone,
            perTest: (!usesWorkerQuickJS && data.phase === 'quickjs') || data.phase === 'v8',
            status: data.status === 'done' ? 'done' : 'running',
          })

          const multiRuntimeKey = data.multiRuntime ? JSON.stringify(data.multiRuntime) : null
          if (multiRuntimeKey && multiRuntimeKey !== lastMultiRuntimeKey) {
            lastMultiRuntimeKey = multiRuntimeKey
            applyMultiRuntimeInfo(data.multiRuntime, start.multiRuntimeCacheKey)
          }

          if (data.status === 'done') {
            setAnalysis(data.analysis)
            setAnalysisStatus('done')
            return
          }

          if (data.status === 'errored') {
            throw new Error(data.error || 'Donor analysis job failed')
          }

          await sleep(750)
        }
      }

      if (start.tier === 'donor' && !start.cached) {
        await runDonorAnalysisJob()
        return
      }

      publishAnalysisProgress({ engine: 'complexity', testIndex: 0, status: 'running' })
      setAnalysisStepStatus('complexity', 'running')
      setAnalysisStepStatus('multi-runtime', 'running')
      const workerPromise = postJson('/api/benchmark/analyze/worker', { sessionId: start.sessionId })
        .then((data) => {
          publishAnalysisProgress({ engine: 'complexity', testIndex: 0, status: 'done' })
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
        publishAnalysisProgress({ engine, testIndex: 0, status: 'running' })
        setAnalysisStepStatus(engine, 'running')
        const data = await postJson(url, { sessionId: start.sessionId })
        publishAnalysisProgress({ engine, testIndex: 0, status: 'done' })
        setAnalysisStepStatus(engine, 'done')
        return data.profiles
      }

      const [quickjsProfiles, v8Profiles, worker] = await Promise.all([
        runEngine('quickjs', '/api/benchmark/analyze/quickjs'),
        runEngine('v8', '/api/benchmark/analyze/v8'),
        workerPromise,
      ])

      publishAnalysisProgress({ engine: 'prediction', testIndex: 0, status: 'running' })
      setAnalysisStepStatus('prediction', 'running')
      const final = await postJson('/api/benchmark/analyze/finalize', {
        sessionId: start.sessionId,
        quickjsProfiles,
        v8Profiles,
        complexities: worker.complexities,
        multiRuntime: worker.multiRuntime,
      })
      publishAnalysisProgress({ engine: 'prediction', testIndex: 0, status: 'done' })
      setAnalysisStepStatus('prediction', 'done')
      setAnalysis(final)
      setAnalysisStatus('done')
    } catch (e: any) {
      setAnalysisError(e.message || 'Failed to connect to analysis server')
      setAnalysisStatus('error')
    }
  }, [tests, setup, teardown, language, languageOptions, slug, revision, runtimeTargets, isDonor, workerSideQuickJS, pollMultiRuntime, setAnalysisStepStatus, publishAnalysisProgress])

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
    if (analysisStatus !== 'loading') return

    const timer = setInterval(() => {
      setAnalysisProgress(prev => ({
        ...(prev || { engine: 'quickjs', testIndex: 0, status: 'running' }),
        heartbeat: Number(prev?.heartbeat || 0) + 1,
        tick: Date.now(),
      }))
    }, ANALYSIS_PROGRESS_HEARTBEAT_MS)

    return () => clearInterval(timer)
  }, [analysisStatus])

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
    workerSideQuickJS,
    runtimeModalOpen,
    runtimeModalForce,
    setRuntimeTargets,
    setWorkerSideQuickJS,
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
