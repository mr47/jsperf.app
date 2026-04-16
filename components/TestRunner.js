import PostMessageBroker from '../utils/postMessageBroker'
import { SANDBOX_IFRAME_FLAGS } from '../utils/sandboxIframe'
import { useState, useEffect, useRef, useCallback } from 'react'
import UserAgent from './UserAgent'
import UAParser from 'ua-parser-js'
import Test from './Test'
import StatsChart from './StatsChart'
import DeepAnalysis from './DeepAnalysis'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber } from '../utils/ArrayUtils'
import { ChevronDown, Microscope, Loader2 } from 'lucide-react'

// Simple SVG logos
const ClaudeLogo = ({ className }) => (
  <img src="/claude.webp" alt="Claude Logo" className={`object-contain ${className}`} />
)

const ChatGPTLogo = ({ className }) => (
  <img src="/openai.webp" alt="ChatGPT Logo" className={`object-contain ${className}`} />
)

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

  const runDeepAnalysis = useCallback(async () => {
    setAnalysisStatus('loading')
    setAnalysisError(null)
    setAnalysisProgress(null)

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

      // Cache hits return standard JSON
      if (contentType.includes('application/json')) {
        const data = await res.json()
        setAnalysis(data)
        setAnalysisStatus('done')
        return
      }

      // NDJSON streaming response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)

          if (msg.type === 'progress') {
            setAnalysisProgress({ engine: msg.engine, testIndex: msg.testIndex, status: msg.status })
          } else if (msg.type === 'result') {
            setAnalysis(msg.data)
            setAnalysisStatus('done')
          } else if (msg.type === 'error') {
            setAnalysisError(msg.error)
            setAnalysisStatus('error')
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const msg = JSON.parse(buffer)
        if (msg.type === 'result') {
          setAnalysis(msg.data)
          setAnalysisStatus('done')
        } else if (msg.type === 'error') {
          setAnalysisError(msg.error)
          setAnalysisStatus('error')
        }
      }
    } catch (e) {
      setAnalysisError(e.message || 'Failed to connect to analysis server')
      setAnalysisStatus('error')
    }
  }, [tests, setup, teardown, slug, revision])

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
          `  JIT Amplification:     ${r.prediction?.jitBenefit ?? 'N/A'}x`,
          `  Scaling Type:          ${r.prediction?.scalingType ?? 'N/A'} (confidence: ${r.prediction?.scalingConfidence != null ? (r.prediction.scalingConfidence * 100).toFixed(0) + '%' : 'N/A'})`,
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
These results come from isolated, reproducible server runs — QuickJS-WASM as a deterministic interpreter baseline and V8 in a Firecracker microVM for realistic JIT profiling.

${serverResults}

${divergenceNote}`
    }

    const prompt = `I ran a JavaScript performance benchmark. Please analyze the results and explain why the fastest snippet is faster, focusing on V8/browser engine optimizations.

### Browser Benchmark Results:
${resultsText}

### Code Snippets:
${codeText}${analysisSection}

Why is the fastest snippet performing better in modern JavaScript engines?${includeAnalysis ? ' Use the deep analysis data (JIT amplification, scaling type, characteristics) to give a more precise explanation.' : ''}`

    return encodeURIComponent(prompt)
  }

  return (
    <>
      <Card className="my-6 shadow-sm border-border/60">
        <CardContent className="p-4">
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
                  onClick={runDeepAnalysis}
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
        </CardContent>
      </Card>
      
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
              <th title="Operations per second (higher is better)" className="py-3 px-4 font-semibold text-center">Ops/sec</th>
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
          onRetry={runDeepAnalysis}
          progress={analysisProgress}
          testCount={tests.length}
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
