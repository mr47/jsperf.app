import PostMessageBroker from '../utils/postMessageBroker'
import { SANDBOX_IFRAME_FLAGS } from '../utils/sandboxIframe'
import { useState, useEffect, useRef, useCallback } from 'react'
import UserAgent from './UserAgent'
import UAParser from 'ua-parser-js'
import Test from './Test'
import StatsChart from './StatsChart'
import DeepAnalysis from './DeepAnalysis'
import RuntimeVersionSelector from './RuntimeVersionSelector'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '../utils/ArrayUtils'
import { ChevronDown, Microscope, Loader2, X } from 'lucide-react'

// Simple SVG logos
const ClaudeLogo = ({ className }) => (
  <img src="/claude.webp" alt="Claude Logo" className={`object-contain ${className}`} />
)

const ChatGPTLogo = ({ className }) => (
  <img src="/openai.webp" alt="ChatGPT Logo" className={`object-contain ${className}`} />
)

const RUNTIME_LABELS_FOR_PROMPT = { node: 'Node.js (V8)', deno: 'Deno (V8)', bun: 'Bun (JSC)' }
const RUNTIME_ORDER_FOR_PROMPT = ['node', 'deno', 'bun']

/**
 * Render a compact, prompt-friendly multi-runtime block for the LLM.
 *
 * We only include data for tests where the comparison is `available` (at
 * least one runtime returned numbers). Hardware perf counters are added
 * inline only when at least one runtime captured them — most snippets
 * won't need them, and this keeps the prompt small enough to paste.
 *
 * Returns '' when there's no useful data to include, so the caller can
 * cheaply concatenate without checking.
 */
function formatMultiRuntimeForPrompt(multiRuntimeData) {
  const results = multiRuntimeData?.results
  if (!Array.isArray(results) || results.length === 0) return ''

  const ready = results.filter(r => r?.state === 'done' && r.runtimeComparison?.available)
  if (ready.length === 0) return ''

  const blocks = ready.map((r) => {
    const cmp = r.runtimeComparison
    const ordered = [...cmp.runtimes].sort(compareRuntimeForPrompt)

    const runtimeLines = ordered.map((rt) => {
      const p = rt.profiles?.[0] || {}
      const c = p.perfCounters || {}

      const fmtLatency = (ms) => {
        if (ms == null || !Number.isFinite(ms)) return 'n/a'
        if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`
        if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`
        return `${ms.toFixed(2)}ms`
      }
      const fmtBytes = (n) => {
        if (n == null) return 'n/a'
        if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
        if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
        return `${n}B`
      }
      const fmtBig = (n) => {
        if (n == null || !Number.isFinite(n)) return 'n/a'
        if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
        return String(Math.round(n))
      }

      const ipc = (c.instructions != null && c.cycles != null && c.cycles > 0)
        ? (c.instructions / c.cycles).toFixed(2)
        : null

      const perfBits = []
      if (ipc != null) perfBits.push(`IPC=${ipc}`)
      if (c.instructions != null) perfBits.push(`instr=${fmtBig(c.instructions)}`)
      if (c['cache-misses'] != null) perfBits.push(`cache-miss=${fmtBig(c['cache-misses'])}`)
      if (c['branch-misses'] != null) perfBits.push(`branch-miss=${fmtBig(c['branch-misses'])}`)

      const perfStr = perfBits.length > 0 ? `; ${perfBits.join(', ')}` : ''
      const opsStr = `${formatNumber(rt.avgOpsPerSec)} ops/s`
      const latStr = `p50=${fmtLatency(p.latencyMean)} p99=${fmtLatency(p.latencyP99)}`
      const memStr = p.rss != null ? ` rss=${fmtBytes(p.rss)}` : ''

      return `    ${runtimeLabelForPrompt(rt)}: ${opsStr}; ${latStr}${memStr}${perfStr}`
    }).join('\n')

    const fastest = runtimeLabelForPrompt(cmp.runtimes.find(rt => rt.runtime === cmp.fastestRuntime) || { runtime: cmp.fastestRuntime })
    const slowest = runtimeLabelForPrompt(cmp.runtimes.find(rt => rt.runtime === cmp.slowestRuntime) || { runtime: cmp.slowestRuntime })
    const spreadLine = (cmp.spread > 1 && fastest && slowest)
      ? `\n    ➜ ${cmp.spread}x throughput spread (fastest: ${fastest}, slowest: ${slowest})`
      : ''

    return `--- Test ${r.testIndex + 1} ---\n${runtimeLines}${spreadLine}`
  }).join('\n\n')

  return `

### Multi-Runtime Comparison (Node.js / Deno / Bun, same isolated single-core CPU+memory budget):
Each runtime ran the same snippet inside its own Docker container with identical resource limits. V8 powers Node and Deno; Bun uses JavaScriptCore. Differences are real engine/runtime effects, not hardware noise.

${blocks}`
}

function compareRuntimeForPrompt(a, b) {
  const orderA = RUNTIME_ORDER_FOR_PROMPT.indexOf(runtimeBaseForPrompt(a))
  const orderB = RUNTIME_ORDER_FOR_PROMPT.indexOf(runtimeBaseForPrompt(b))
  const normalizedA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA
  const normalizedB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB
  if (normalizedA !== normalizedB) return normalizedA - normalizedB
  return runtimeLabelForPrompt(a).localeCompare(runtimeLabelForPrompt(b), undefined, { numeric: true })
}

function runtimeLabelForPrompt(entry) {
  const base = runtimeBaseForPrompt(entry)
  const version = entry?.version || runtimeVersionForPrompt(entry?.runtime)
  const label = RUNTIME_LABELS_FOR_PROMPT[base] || base || entry?.runtime || 'runtime'
  return version ? `${label} ${version}` : label
}

function runtimeBaseForPrompt(entry) {
  return (entry?.runtimeName || entry?.runtime || '').split('@')[0]
}

function runtimeVersionForPrompt(runtimeId) {
  if (typeof runtimeId !== 'string') return null
  const marker = runtimeId.indexOf('@')
  return marker === -1 ? null : runtimeId.slice(marker + 1)
}

function RuntimeAnalysisModal({
  open,
  force,
  loading,
  runtimeTargets,
  onRuntimeTargetsChange,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
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

export default function Tests(props) {
  const {id, slug, revision, setup, teardown} = props

  const [statusMessage, setStatusMessage] = useState('')
  const [benchStatus, setBenchStatus] = useState('notready')
  const [testDuration, setTestDuration] = useState(5)
  const [showRunDropdown, setShowRunDropdown] = useState(false)
  const [showAIDropdown, setShowAIDropdown] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [broker, setBroker] = useState(null)
  const [tests, setTests] = useState(props.tests)
  const [stats, setStats] = useState(null)

  const [analysisStatus, setAnalysisStatus] = useState('idle')
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [analysisPipeline, setAnalysisPipeline] = useState(null)
  // When the analysis came from the persisted snapshot rather than a
  // live run, we surface a small banner with the snapshot date and a
  // "re-run" affordance. `null` means it's a fresh run from this session.
  const [analysisCachedAt, setAnalysisCachedAt] = useState(null)

  // Multi-runtime is asynchronous: the analyze endpoint enqueues jobs on
  // the worker and returns immediately with jobIds. We poll those jobs
  // here while the user is already looking at the base results.
  //   status: 'idle' | 'pending' | 'done' | 'errored' | 'unavailable'
  //   data:   { results: [{ testIndex, runtimes, runtimeComparison }, ...] }
  const [multiRuntimeStatus, setMultiRuntimeStatus] = useState('idle')
  const [multiRuntimeData, setMultiRuntimeData] = useState(null)
  const [multiRuntimeError, setMultiRuntimeError] = useState(null)
  const [runtimeTargets, setRuntimeTargets] = useState(null)
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false)
  const [runtimeModalForce, setRuntimeModalForce] = useState(false)
  const multiRuntimeAbortRef = useRef(null)

  const windowRef = useRef(null)
  const isQuickRunRef = useRef(false)
  const lastHeartbeatRef = useRef(0)
  const watchdogTimerRef = useRef(null)
  const stoppedForVisibilityRef = useRef(false)

  const fetchStats = useCallback(() => {
    if (slug && revision) {
      fetch(`/api/stats?slug=${slug}&revision=${revision}`)
        .then(res => res.json())
        .then(data => setStats(data))
        .catch(err => console.error('Failed to fetch stats', err))
    }
  }, [slug, revision])

  // Poll the multi-runtime proxy endpoint until every enqueued job
  // resolves (or the deadline is hit). Updates state incrementally so
  // the per-test panels can render as soon as their job finishes,
  // instead of waiting for the slowest one.
  const pollMultiRuntime = useCallback(async ({ jobs, codeHash, deadlineMs }) => {
    if (!Array.isArray(jobs) || jobs.length === 0) return

    setMultiRuntimeStatus('pending')
    setMultiRuntimeData({ results: jobs.map(j => ({ testIndex: j.testIndex, state: 'pending' })) })

    const controller = new AbortController()
    multiRuntimeAbortRef.current?.abort()
    multiRuntimeAbortRef.current = controller

    // Soft client-side ceiling. The worker enforces its own deadline; we
    // add ~30s of slack on top to cover network jitter and queueing.
    const overallDeadline = Date.now() + (Number(deadlineMs) || 30_000) + 30_000
    const remaining = new Map(jobs.map(j => [j.testIndex, j.jobId]))
    const collected = new Map()
    let firstError = null

    const sleep = (ms) => new Promise(r => setTimeout(r, ms))

    while (remaining.size > 0 && Date.now() < overallDeadline && !controller.signal.aborted) {
      const polls = await Promise.all(
        Array.from(remaining.entries()).map(async ([testIndex, jobId]) => {
          try {
            const url = `/api/benchmark/multi-runtime/${encodeURIComponent(jobId)}`
              + `?testIndex=${testIndex}`
              + (codeHash ? `&codeHash=${encodeURIComponent(codeHash)}` : '')
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) return { testIndex, transient: true }
            const body = await res.json()
            return { testIndex, body }
          } catch (err) {
            if (err.name === 'AbortError') throw err
            return { testIndex, transient: true }
          }
        })
      )

      for (const p of polls) {
        if (!p.body) continue
        if (p.body.state === 'done') {
          collected.set(p.testIndex, {
            testIndex: p.testIndex,
            state: 'done',
            runtimes: p.body.runtimes,
            runtimeComparison: p.body.runtimeComparison,
          })
          remaining.delete(p.testIndex)
        } else if (p.body.state === 'errored') {
          collected.set(p.testIndex, {
            testIndex: p.testIndex,
            state: 'errored',
            error: p.body.error,
          })
          if (!firstError) firstError = p.body.error
          remaining.delete(p.testIndex)
        } else {
          collected.set(p.testIndex, {
            testIndex: p.testIndex,
            state: p.body.state,
            partial: p.body.partial || null,
          })
        }
      }

      // Snapshot incremental state so per-test panels render as soon as
      // they're ready (don't wait for the slowest job to finish).
      setMultiRuntimeData({
        results: jobs.map(j =>
          collected.get(j.testIndex) || { testIndex: j.testIndex, state: 'pending' }
        ),
      })

      if (remaining.size === 0) break
      await sleep(1500)
    }

    if (controller.signal.aborted) return

    if (remaining.size > 0) {
      setMultiRuntimeStatus('errored')
      setMultiRuntimeError('Multi-runtime polling timed out')
      return
    }

    const allErrored = Array.from(collected.values()).every(r => r.state === 'errored')
    if (allErrored) {
      setMultiRuntimeStatus('errored')
      setMultiRuntimeError(firstError || 'All multi-runtime jobs failed')
    } else {
      setMultiRuntimeStatus('done')
    }
  }, [])

  // Publish the live analysis + multi-runtime snapshot to the window
  // so the "Generate report" button (which lives in the page header,
  // outside this component's tree) can grab the freshest data without
  // us having to thread a context through Layout. This is intentionally
  // scoped per-benchmark: keyed by slug+revision so reports for one
  // page never leak data captured on another.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (analysisStatus !== 'done' || !analysis) {
      delete window.__jsperfLiveAnalysis
      return
    }
    window.__jsperfLiveAnalysis = {
      slug, revision,
      analysis,
      multiRuntime: multiRuntimeData || null,
      multiRuntimeStatus,
      capturedAt: Date.now(),
    }
    return () => { delete window.__jsperfLiveAnalysis }
  }, [analysisStatus, analysis, multiRuntimeData, multiRuntimeStatus, slug, revision])

  const runDeepAnalysis = useCallback(async ({ force = false } = {}) => {
    setAnalysisStatus('loading')
    setAnalysisError(null)
    setAnalysisProgress(null)
    setAnalysisPipeline(null)
    setAnalysisCachedAt(null)
    setMultiRuntimeStatus('idle')
    setMultiRuntimeData(null)
    setMultiRuntimeError(null)
    multiRuntimeAbortRef.current?.abort()
    multiRuntimeAbortRef.current = null

    try {
      const res = await fetch('/api/benchmark/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tests: tests.map(t => ({ code: t.code, title: t.title, async: !!t.async })),
          setup,
          teardown,
          slug,
          revision,
          force,
          ...(Array.isArray(runtimeTargets) && runtimeTargets.length > 0
            ? { runtimes: runtimeTargets }
            : {}),
        }),
      })

      if (res.status === 429) {
        setAnalysisError('Rate limited — please wait a minute before trying again.')
        setAnalysisStatus('error')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setAnalysisError(data.error || `Server error (${res.status})`)
        setAnalysisStatus('error')
        return
      }

      const contentType = res.headers.get('Content-Type') || ''

      // Cache hits return standard JSON. Multi-runtime data may already be
      // cached, or the API may return fresh worker jobIds to poll.
      if (contentType.includes('application/json')) {
        const data = await res.json()
        setAnalysis(data)
        setAnalysisStatus('done')
        if (data?.multiRuntime?.results) {
          setMultiRuntimeData({ results: data.multiRuntime.results })
          setMultiRuntimeStatus('done')
        } else if (data?.multiRuntime?.jobs) {
          pollMultiRuntime({
            jobs: data.multiRuntime.jobs,
            codeHash: data.multiRuntime.cacheKey || data.codeHash || null,
            deadlineMs: data.multiRuntime.deadlineMs,
          })
        } else if (data?.multiRuntime?.unavailable) {
          setMultiRuntimeStatus('unavailable')
          setMultiRuntimeError(data.multiRuntime.error || null)
        }
        return
      }

      // NDJSON streaming response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let mrEnqueueInfo = null
      let mrCodeHash = null

      const handleMessage = (msg) => {
        if (msg.type === 'pipeline') {
          setAnalysisPipeline(Array.isArray(msg.engines) ? msg.engines : null)
        } else if (msg.type === 'multi-runtime-enqueued') {
          mrEnqueueInfo = { jobs: msg.jobs, deadlineMs: msg.deadlineMs }
          mrCodeHash = msg.codeHash || null
          setMultiRuntimeStatus('pending')
          setMultiRuntimeData({
            results: (msg.jobs || []).map(j => ({ testIndex: j.testIndex, state: 'pending' })),
          })
        } else if (msg.type === 'multi-runtime-stored' || msg.type === 'multi-runtime-cached') {
          setMultiRuntimeData({ results: msg.results || [] })
          setMultiRuntimeStatus('done')
        } else if (msg.type === 'multi-runtime-unavailable') {
          setMultiRuntimeStatus('unavailable')
          setMultiRuntimeError(msg.error || null)
        } else if (msg.type === 'progress') {
          setAnalysisProgress({
            engine: msg.engine,
            testIndex: msg.testIndex,
            status: msg.status,
            runtime: msg.runtime,
            profile: msg.profile,
          })
        } else if (msg.type === 'result') {
          setAnalysis(msg.data)
          setAnalysisStatus('done')
        } else if (msg.type === 'error') {
          setAnalysisError(msg.error)
          setAnalysisStatus('error')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          handleMessage(JSON.parse(line))
        }
      }

      if (buffer.trim()) handleMessage(JSON.parse(buffer))

      // Now that the base analysis is in, start polling the worker for
      // multi-runtime results. The worker probably finished while we
      // were running QuickJS+V8, so the first poll usually returns done.
      if (mrEnqueueInfo) {
        pollMultiRuntime({ ...mrEnqueueInfo, codeHash: mrCodeHash })
      }
    } catch (e) {
      setAnalysisError(e.message || 'Failed to connect to analysis server')
      setAnalysisStatus('error')
    }
  }, [tests, setup, teardown, slug, revision, runtimeTargets, pollMultiRuntime])

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

  // Load any persisted deep-analysis snapshot for this benchmark
  // revision so users see results immediately instead of waiting ~30s
  // for QuickJS+V8 to re-run on every visit. The "Re-analyze" button
  // can be used to force a fresh run.
  useEffect(() => {
    if (!slug || revision == null) return
    let cancelled = false
    fetch(`/api/benchmark/analysis?slug=${encodeURIComponent(slug)}&revision=${encodeURIComponent(revision)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data?.analysis) return
        // Only adopt the cached snapshot if the user hasn't already
        // triggered a live run while we were fetching.
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

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Page Visibility API: pause benchmark when tab is not active.
  // Background tabs throttle timers/rAF which both breaks measurements
  // and trips the iframe heartbeat watchdog (falsely failing tests).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      if (benchStatus !== 'running' || !broker) return

      clearInterval(watchdogTimerRef.current)
      watchdogTimerRef.current = null
      stoppedForVisibilityRef.current = true
      broker.emit('run', { options: undefined })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [benchStatus, broker])

  useEffect(() => {
    if (!windowRef.current) return
    const _broker = new PostMessageBroker(windowRef.current.contentWindow)

    setBroker(_broker)

    _broker.register('cycle', event => {
      lastHeartbeatRef.current = performance.now()
      const {
        id: rawId, name, count, size, status,
        elapsed, total, opsPerSec, taskIndex, taskCount, error
      } = event.data
      const id = Number(rawId)

      if (status === 'running') {
        const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0
        const hzEstimate =
          opsPerSec > 0 ? `~${formatNumber(Math.round(opsPerSec))} ops/s` : 'warming up…'
        const taskProgress =
          taskCount > 1 ? `[${taskIndex + 1}/${taskCount}] ` : ''
        setStatusMessage(`${taskProgress}${name} — ${hzEstimate} — ${pct}%`)
      } else if (!['finished', 'completed', 'error'].includes(status)) {
        setStatusMessage(`${name} × ${count} (${size} sample${size === 1 ? '' : 's'})`)
      }

      setTests((prevTests) =>
        prevTests.map((test, idx) => {
          if (idx !== id) return test
          if (
            test.hz != null &&
            test.status === 'finished' &&
            status !== 'finished'
          ) {
            return test
          }
          return {
            ...test,
            status,
            ...(status === 'running' ? { elapsed, total, opsPerSec } : {}),
            ...(status === 'error' ? { error } : {}),
          }
        })
      )
    })

    _broker.register('complete', event => {
      clearInterval(watchdogTimerRef.current)
      const {results} = event.data

      setTests((prevTests) => {
        const next = [...prevTests]
        for (const result of results) {
          const i = Number(result.id)
          if (!Number.isInteger(i) || i < 0 || i >= next.length) continue
          next[i] = { ...prevTests[i], ...result }
        }
        
        // Background task to send stats, but only for full runs (not quick runs or aborts)
        if (slug && revision && !isQuickRunRef.current && !stoppedForVisibilityRef.current) {
          try {
            const parser = new UAParser()
            const browser = parser.getBrowser()
            const os = parser.getOS()
            const device = parser.getDevice()
            const cpu = parser.getCPU()
            
            let renderer = 'unknown'
            try {
              const canvas = document.createElement('canvas')
              const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
              if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
                if (debugInfo) {
                  renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                }
              }
            } catch (e) {}
            
            const payload = {
              slug,
              revision,
              browserName: browser.name || 'unknown',
              browserVersion: browser.version || 'unknown',
              osName: os.name || 'unknown',
              deviceType: device.type || 'desktop',
              cpuArch: cpu.architecture || 'unknown',
              renderer,
              cpuCores: navigator.hardwareConcurrency || null,
              ramGB: navigator.deviceMemory || null,
              results: next.map((t, idx) => ({
                testIndex: idx,
                opsPerSec: t.opsPerSec || 0
              }))
            }

            fetch('/api/runs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            .then(() => fetchStats()) // Refresh stats after sending
            .catch(e => console.error('Failed to send runs payload', e))
          } catch(e) {
            console.error('Failed to parse UA or send runs payload', e)
          }
        }

        return next
      })
      if (stoppedForVisibilityRef.current) {
        stoppedForVisibilityRef.current = false
        setStatusMessage('Stopped — tab became inactive. Run again when ready.')
        setBenchStatus('ready')
      } else {
        setStatusMessage('Done. Ready to run again.')
        setBenchStatus('complete')
      }
    })

    _broker.register('ready', () => {
      setStatusMessage('Ready to run.')
      setBenchStatus('ready')
    })

    return () => {
      _broker.unregisterAll()
      clearInterval(watchdogTimerRef.current)
    }
  }, [iframeKey, slug, revision])

  const sandboxUrl = `/sandbox/${id}`

  const run = (options) => {
    clearInterval(watchdogTimerRef.current)

    if (!options) {
      broker.emit('run', {options})
      setStatusMessage('Stopped.')
      setBenchStatus('ready')
      return
    }

    isQuickRunRef.current = options && options.maxTime < 5
    broker.emit('run', {options})

    lastHeartbeatRef.current = performance.now()
    watchdogTimerRef.current = setInterval(() => {
      // If we haven't heard from the iframe in 3 seconds, it's likely stuck in an infinite loop
      if (performance.now() - lastHeartbeatRef.current > 3000) {
        clearInterval(watchdogTimerRef.current)
        
        setTests((prevTests) => prevTests.map((test) => {
          if (test.status === 'running' || test.status === 'pending') {
            return {
              ...test,
              status: 'error',
              error: 'Test execution timed out (infinite loop detected?)'
            }
          }
          return test
        }))
        
        setStatusMessage('Test timed out. Iframe reset.')
        setBenchStatus('complete')
        setIframeKey(k => k + 1)
      }
    }, 1000)

    setTests((prevTests) =>
      prevTests.map((test) => ({
        ...test,
        status: 'pending',
        elapsed: undefined,
        total: undefined,
        opsPerSec: undefined,
      }))
    )

    setBenchStatus('running')
  }

  const finishedTests = tests.filter((t) => t.status === 'finished')
  const showUnboundedNote =
    finishedTests.length > 0 && finishedTests.every((t) => t.tied)

  const generateAIPrompt = (includeAnalysis = false) => {
    const resultsText = tests
      .map((t, idx) => `Test ${idx + 1} (${t.title}): ${t.opsPerSec ? formatNumber(Math.round(t.opsPerSec)) : 'Error or Infinity'} ops/sec`)
      .join('\n')
      
    const codeText = tests
      .map((t, idx) => `--- Test ${idx + 1} (${t.title}) ---\n${t.code}`)
      .join('\n\n')

    let analysisSection = ''
    if (includeAnalysis && analysis?.results) {
      const serverResults = analysis.results.map((r) => {
        const chars = r.prediction?.characteristics || {}
        const activeChars = Object.entries(chars)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(', ')

        return [
          `--- Test ${r.testIndex + 1} (${r.title}) ---`,
          `  QuickJS (interpreter): ${formatNumber(Math.round(r.quickjs.opsPerSec))} ops/sec`,
          `  V8 (JIT):              ${formatNumber(Math.round(r.v8.opsPerSec))} ops/sec`,
          r.complexity ? `  Static Complexity:    time ${r.complexity.time?.notation || 'unknown'}, space ${r.complexity.space?.notation || 'unknown'}${r.complexity.async?.mode && r.complexity.async.mode !== 'none' ? `, async ${r.complexity.async.mode}` : ''}` : null,
          r.complexity?.explanation ? `  Complexity Notes:     ${r.complexity.explanation}` : null,
          `  JIT Amplification:     ${r.prediction?.jitBenefit ?? 'N/A'}x`,
          `  Memory Response:       ${r.prediction?.scalingType ?? 'N/A'} (fit quality: ${r.prediction?.scalingConfidence != null ? (r.prediction.scalingConfidence * 100).toFixed(0) + '%' : 'N/A'})`,
          `  Memory Sensitivity:    ${r.prediction?.memSensitivity ?? 'N/A'}`,
          activeChars ? `  Characteristics:       ${activeChars}` : null,
        ].filter(Boolean).join('\n')
      }).join('\n\n')

      const comp = analysis.comparison
      const divergenceNote = comp?.divergence
        ? `Note: The algorithmically fastest snippet (by interpreter) differs from the runtime fastest (by V8 JIT). The winner is determined by JIT optimization, not algorithm.`
        : `The algorithmic ranking (interpreter) and runtime ranking (V8 JIT) agree.`

      analysisSection = `

### Deep Analysis (Server-Side Controlled Environment):
These results come from isolated server runs — QuickJS-WASM provides a deterministic interpreter baseline and memory-limit sweep; V8 runs once in a single-vCPU Firecracker microVM for realistic canonical JIT profiling.

${serverResults}

${divergenceNote}`

      const multiRuntimeSection = formatMultiRuntimeForPrompt(multiRuntimeData)
      if (multiRuntimeSection) {
        analysisSection += multiRuntimeSection
      }
    }

    const promptHints = []
    if (includeAnalysis) promptHints.push('JIT amplification, memory response, static complexity, characteristics')
    if (includeAnalysis && multiRuntimeStatus === 'done') {
      promptHints.push('cross-runtime variation (Node/Deno/Bun) and hardware perf counters where available')
    }

    const prompt = `I ran a JavaScript performance benchmark. Please analyze the results and explain why the fastest snippet is faster, focusing on V8/browser engine optimizations.

### Browser Benchmark Results:
${resultsText}

### Code Snippets:
${codeText}${analysisSection}

Why is the fastest snippet performing better in modern JavaScript engines?${promptHints.length > 0 ? ` Use the deep analysis data (${promptHints.join('; ')}) to give a more precise explanation.` : ''}`

    return encodeURIComponent(prompt)
  }

  return (
    <>
      <Card className="my-6 shadow-sm border-border/60">
        <CardContent className="p-4">
          <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold tracking-tight">Test Runner</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{statusMessage || 'Initializing...'}</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              { benchStatus === 'complete' &&
                <div className="relative inline-flex items-center h-9">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-full font-bold shadow-sm border-orange-500/30 bg-orange-50/50 hover:bg-orange-100/50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:hover:bg-orange-500/20 dark:text-orange-400 rounded-r-none border-r-0 focus:z-10"
                    asChild>
                    <a href={`https://claude.ai/new?q=${generateAIPrompt()}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-4">
                      <ClaudeLogo className="w-4 h-4 object-contain rounded-sm" />
                      Ask Claude
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-full px-2 shadow-sm border-orange-500/30 bg-orange-50/50 hover:bg-orange-100/50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:hover:bg-orange-500/20 dark:text-orange-400 rounded-l-none focus:z-10"
                    onClick={() => setShowAIDropdown(!showAIDropdown)}>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                  
                  {showAIDropdown && (
                    <div className="absolute top-[calc(100%+4px)] right-0 min-w-max bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden">
                      <a 
                        href={`https://chatgpt.com/?model=gpt-4o&q=${generateAIPrompt()}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 text-sm font-bold hover:bg-muted/50 transition-colors text-foreground"
                        onClick={() => setShowAIDropdown(false)}
                      >
                        <ChatGPTLogo className="w-4 h-4 object-contain rounded-sm" />
                        Ask ChatGPT
                      </a>
                      {analysisStatus === 'done' && analysis && (
                        <>
                          <div className="border-t border-border/60 mx-2" />
                          <a
                            href={`https://claude.ai/new?q=${generateAIPrompt(true)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 text-sm font-bold hover:bg-muted/50 transition-colors text-violet-700 dark:text-violet-400"
                            onClick={() => setShowAIDropdown(false)}
                          >
                            <ClaudeLogo className="w-4 h-4 object-contain rounded-sm" />
                            Ask Claude + Analysis
                          </a>
                          <a
                            href={`https://chatgpt.com/?model=gpt-4o&q=${generateAIPrompt(true)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 text-sm font-bold hover:bg-muted/50 transition-colors text-violet-700 dark:text-violet-400"
                            onClick={() => setShowAIDropdown(false)}
                          >
                            <ChatGPTLogo className="w-4 h-4 object-contain rounded-sm" />
                            Ask ChatGPT + Analysis
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              }
              { benchStatus === 'complete' &&
                <Button
                  type="button"
                  variant="outline"
                  disabled={analysisStatus === 'loading'}
                  className="h-9 font-bold shadow-sm border-violet-500/30 bg-violet-50/50 hover:bg-violet-100/50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:hover:bg-violet-500/20 dark:text-violet-400"
                  onClick={() => openRuntimeAnalysisModal(analysisStatus === 'done')}
                >
                  {analysisStatus === 'loading' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Microscope className="w-4 h-4" />
                  )}
                  {analysisStatus === 'loading' ? 'Analyzing...' : analysisStatus === 'done' ? 'Re-analyze' : 'Deep Analysis'}
                </Button>
              }
              { ['ready', 'complete'].includes(benchStatus) &&
                <div className="relative inline-flex items-center h-9">
                  <Button
                    id="run"
                    type="button"
                    disabled={benchStatus === 'notready'}
                    size="default"
                    className="h-full font-bold shadow-sm rounded-r-none border-r border-r-primary-foreground/20 focus:z-10"
                    onClick={() => run({maxTime: testDuration})}>
                    Run Tests ({testDuration < 1 ? testDuration : Math.round(testDuration)}s)
                  </Button>
                  <Button
                    type="button"
                    disabled={benchStatus === 'notready'}
                    size="default"
                    className="h-full px-2 shadow-sm rounded-l-none focus:z-10"
                    onClick={() => setShowRunDropdown(!showRunDropdown)}>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                  {showRunDropdown && (
                    <div className="absolute top-[calc(100%+4px)] right-0 w-full bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden py-1">
                      <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border/50 mb-1">
                        Test Duration
                      </div>
                      {[
                        { val: 0.5, label: 'Quick (0.5s)' },
                        { val: 1, label: 'Short (1s)' },
                        { val: 5, label: 'Default (5s)' },
                        { val: 10, label: 'Long (10s)' },
                        { val: 30, label: 'Extra Long (30s)' },
                      ].map(opt => (
                        <button
                          key={opt.val}
                          className={`w-full text-left flex items-center justify-between px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors ${testDuration === opt.val ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
                          onClick={() => {
                            setTestDuration(opt.val)
                            setShowRunDropdown(false)
                          }}
                        >
                          {opt.label}
                          {testDuration === opt.val && <span className="text-primary text-xs">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
              { benchStatus === 'running' &&
                <Button
                  type="button"
                  variant="destructive"
                  size="default"
                  className="font-bold shadow-sm"
                  onClick={() => run()}>Stop</Button>
              }
            </div>
          </div>
          </div>
        </CardContent>
      </Card>

      <RuntimeAnalysisModal
        open={runtimeModalOpen}
        force={runtimeModalForce}
        loading={analysisStatus === 'loading'}
        runtimeTargets={runtimeTargets}
        onRuntimeTargetsChange={setRuntimeTargets}
        onClose={closeRuntimeAnalysisModal}
        onConfirm={confirmRuntimeAnalysis}
      />
      
      <iframe
        key={iframeKey}
        src={sandboxUrl}
        ref={windowRef}
        sandbox={SANDBOX_IFRAME_FLAGS}
        title="Benchmark sandbox"
        className="hidden"
        style={{height: "1px", width: "1px"}}></iframe>

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <caption className="bg-muted p-3 text-sm font-medium border-b border-border text-left">
            Testing in <UserAgent />
          </caption>
          <thead className="bg-primary text-primary-foreground">
            <tr>
              <th colSpan="2" className="py-3 px-4 font-semibold border-r border-primary-foreground/20">Test Case</th>
              <th className="py-3 px-4 font-semibold text-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60" tabIndex={0}>
                      Ops/sec
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Operations per second: how many times the test ran each second. Higher is faster.
                  </TooltipContent>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tests.map((test, i) => (
              <Test
                key={`${i}-${test.status}-${String(test.hz ?? '')}-${String(test.percent ?? '')}-${String(test.tied ?? '')}`}
                test={test}
                stats={stats ? stats[i] : null}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {showUnboundedNote && (
        <p className="text-sm text-gray-600 mt-3 max-w-prose">
          Each case finished faster than the benchmark timer could resolve, so ops/sec
          is shown as ∞ and cases are listed as tied — this is a measurement limit, not
          missing data from the runner. Add heavier work inside the test (or a loop) if
          you need a finite ops/sec estimate.
        </p>
      )}

      {analysisStatus !== 'idle' && (
        <DeepAnalysis
          status={analysisStatus}
          analysis={analysis}
          error={analysisError}
          onRetry={() => openRuntimeAnalysisModal(true)}
          progress={analysisProgress}
          pipeline={analysisPipeline}
          testCount={tests.length}
          cachedAt={analysisCachedAt}
          multiRuntime={{
            status: multiRuntimeStatus,
            data: multiRuntimeData,
            error: multiRuntimeError,
          }}
        />
      )}

      {stats && Object.keys(stats).length > 0 && (
        <div className="mt-12">
          <StatsChart stats={stats} tests={tests} />
        </div>
      )}
    </>
  )
}
