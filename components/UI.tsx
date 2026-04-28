import { useEffect, useRef } from 'react'
import PostMessageBroker from '../utils/postMessageBroker'
import { getRanked, formatNumber } from '../utils/ArrayUtils'
import { runBenchmark } from '../utils/benchmark'
import { renderPrepHTML } from '../utils/prepHTML'

function detectRetainedArrayGrowth(code, setup) {
  const setupSource = String(setup || '')
  const testSource = String(code || '')
  const arrayNames = []
  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\[\s*\]|new\s+Array\s*\()/g
  let match

  while ((match = declarationPattern.exec(setupSource))) {
    arrayNames.push(match[1])
  }

  for (const name of arrayNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pushesToSetupArray = new RegExp(`\\b${escaped}\\s*\\.\\s*push\\s*\\(`).test(testSource)
    if (!pushesToSetupArray) continue

    const clearsInsideTest = new RegExp(
      `(?:\\b${escaped}\\s*\\.\\s*length\\s*=\\s*0\\b|\\b${escaped}\\s*=\\s*\\[\\s*\\]|\\b${escaped}\\s*\\.\\s*splice\\s*\\()`
    ).test(testSource)
    if (clearsInsideTest) continue

    return new Error(
      `This test appends to setup array "${name}" on every operation. ` +
      'That retains millions of values during the browser run and can crash the tab before teardown runs. ' +
      'Use a scalar sink, overwrite fixed indexes, or clear the array inside the test body.'
    )
  }

  return null
}

function compileFactory(code, setup, teardown, legacyIsAsync) {
  try {
    // Auto-detect modern async/await or legacy deferred.resolve usage
    const isLegacyAsync = code.includes('deferred.resolve')
    const isModernAsync = code.includes('await ') || code.includes('return new Promise')
    const actuallyAsync = !!legacyIsAsync || isLegacyAsync || isModernAsync

    // If it's the legacy format (or forced via old DB flag), inject the Promise wrapper
    const testBody = (isLegacyAsync || (legacyIsAsync && !isModernAsync))
      ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${code}\n})`
      : code

    const fnPrefix = isModernAsync ? 'async ' : ''

    const body = `
      ${setup || ''}
      var __testFn = ${fnPrefix}function() {
${testBody}
      };
      var __teardownFn = ${fnPrefix}function() {
${teardown || ''}
      };
      return { test: __testFn, teardown: __teardownFn };
    `
    const factory = new Function(body)
    factory()
    return { factory, error: null, actuallyAsync }
  } catch (e) {
    return { factory: null, error: e, actuallyAsync: false }
  }
}

export default (props) => {
  const {
    pageData: { tests, initHTML, setup, teardown, runtime, runtimeCompileError },
  } = props
  const prepRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let abortController = null

    const broker = new PostMessageBroker(
      typeof window !== 'undefined' && window.parent !== window
        ? window.parent
        : window
    )

    const registerRunner = (factories) => broker.register('run', async (event) => {
      if (cancelled) return

      if (abortController) {
        abortController.abort()
        abortController = null
      }

      const { options } = event.data

      if (!options) {
        broker.emit('complete', {
          results: tests.map((_, i) => ({
            id: i, hz: undefined, hzFinite: false, rme: '—',
            fastest: false, tied: false, slowest: false,
            status: 'default', percent: '—',
          })),
        })
        return
      }

      abortController = new AbortController()
      const { signal } = abortController
      const time = options.maxTime ? options.maxTime * 1000 : 5000
      const taskCount = tests.filter((_, i) => !factories[i].error).length

      const benchResults = []
      let taskIndex = 0

      for (let i = 0; i < tests.length; i++) {
        if (signal.aborted) break

        if (factories[i].error) {
          benchResults.push({ index: i, result: { state: 'errored', error: factories[i].error } })
          broker.emit('cycle', {
            id: i,
            name: tests[i].title,
            count: '0',
            size: 0,
            status: 'error',
            error: factories[i].error.message || String(factories[i].error),
          })
          continue
        }

        let compiled
        try {
          compiled = factories[i].factory()
        } catch (e) {
          factories[i].error = e
          benchResults.push({ index: i, result: { state: 'errored', error: e } })
          broker.emit('cycle', {
            id: i,
            name: tests[i].title,
            count: '0',
            size: 0,
            status: 'error',
            error: e.message || String(e),
          })
          continue
        }

        broker.emit('cycle', {
          id: i,
          name: tests[i].title,
          count: '0',
          size: 0,
          status: 'running',
          running: true,
          elapsed: 0,
          total: time,
          opsPerSec: 0,
          taskIndex,
          taskCount,
        })

        const result = await runBenchmark(compiled.test, {
          time,
          isAsync: factories[i].actuallyAsync,
          signal,
          onProgress(elapsed, sampleCount, runs, currentHz) {
            if (signal.aborted) return
            broker.emit('cycle', {
              id: i,
              name: tests[i].title,
              count: formatNumber(runs),
              size: sampleCount,
              status: 'running',
              running: true,
              elapsed: Math.round(elapsed),
              total: time,
              opsPerSec: currentHz,
              taskIndex,
              taskCount,
            })
          },
        })

        if (compiled.teardown) {
          try { compiled.teardown() } catch (_) {}
        }

        if (signal.aborted) break

        benchResults.push({ index: i, result, name: tests[i].title })

        const hasStats =
          result.state === 'completed' || result.state === 'aborted-with-statistics'

        broker.emit('cycle', {
          id: i,
          name: tests[i].title,
          count: hasStats ? formatNumber(result.latency.samplesCount) : '0',
          size: hasStats ? result.latency.samplesCount : 0,
          status: result.state === 'errored' ? 'error' : 'completed',
          error: result.state === 'errored' ? (result.error?.message || String(result.error)) : undefined,
          running: true,
        })
        
        taskIndex++
      }

      if (signal.aborted) return

      const ranked = getRanked(benchResults)
      const fastestEntry = ranked[0]
      const slowestEntry = ranked.length > 1 ? ranked[ranked.length - 1] : undefined
      const fastestHz = fastestEntry?.hz
      const allInfinityTie =
        ranked.length > 1 && ranked.every((r) => r.hz === Infinity)

      const results = tests.map((test, i) => {
        if (factories[i].error) {
          return {
            id: i, hz: undefined, hzFinite: false, rme: '—',
            fastest: false, tied: false, slowest: false,
            status: 'error', error: factories[i].error.message || String(factories[i].error), percent: '—',
          }
        }

        const entry = benchResults.find((r) => r.index === i)
        const result = entry?.result

        if (!result || result.state === 'errored') {
          return {
            id: i, hz: undefined, hzFinite: false, rme: '—',
            fastest: false, tied: false, slowest: false,
            status: 'error', error: result?.error?.message || 'Unknown error', percent: '—',
          }
        }

        const hasStats =
          result.state === 'completed' || result.state === 'aborted-with-statistics'

        const hz = hasStats ? result.throughput.mean : 0

        let hzFormatted
        if (Number.isFinite(hz)) {
          hzFormatted = formatNumber(hz.toFixed(hz < 100 ? 2 : 0))
        } else if (hz === Infinity) {
          hzFormatted = '∞'
        } else {
          hzFormatted = '—'
        }

        const rme = hasStats ? result.latency.rme : 0
        const rmeFormatted =
          hz === Infinity
            ? 'n/a'
            : Number.isFinite(rme)
              ? rme.toFixed(2)
              : '—'

        let percentFormatted = '—'
        if (ranked.length && !allInfinityTie) {
          if (hz === Infinity && fastestHz === Infinity) {
            percentFormatted = formatNumber(0)
          } else if (Number.isFinite(hz) && fastestHz > 0) {
            const perc = (1 - hz / fastestHz) * 100
            if (Number.isFinite(perc)) {
              percentFormatted = formatNumber(
                perc < 1 ? perc.toFixed(2) : Math.round(perc)
              )
            }
          }
        }

        return {
          id: i,
          hz: hzFormatted,
          opsPerSec: hz,
          hzFinite: Number.isFinite(hz),
          rme: rmeFormatted,
          fastest: !allInfinityTie && i === fastestEntry?.index,
          tied: allInfinityTie,
          slowest: !allInfinityTie && i === slowestEntry?.index,
          status: 'finished',
          percent: percentFormatted,
          samples: hasStats ? result.latency.samplesCount : 0,
          meanLatency: hasStats ? result.latency.mean : 0,
          p99Latency: hasStats ? result.latency.p99 : 0,
          p50Latency: hasStats ? result.latency.p50 : 0,
        }
      })

      broker.emit('complete', { results })
    })

    const prepareSandbox = async () => {
      let prepError = null

      try {
        await renderPrepHTML(prepRef.current, initHTML)
      } catch (error) {
        prepError = error
      }

      if (cancelled) return

      const runtimeTests = runtime?.tests || tests
      const runtimeSetup = runtime?.setup ?? setup
      const runtimeTeardown = runtime?.teardown ?? teardown
      const compileError = runtimeCompileError
        ? new Error(runtimeCompileError.message || 'Failed to compile benchmark source')
        : null
      const factories = tests.map((test, index) => {
        const error = prepError || compileError
        if (error) return { factory: null, error, actuallyAsync: false }
        const runtimeTest = runtimeTests[index] || test
        const memoryRisk = detectRetainedArrayGrowth(runtimeTest.code, runtimeSetup)
        if (memoryRisk) return { factory: null, error: memoryRisk, actuallyAsync: false }
        return compileFactory(runtimeTest.code, runtimeSetup, runtimeTeardown, test.async)
      })

      registerRunner(factories)
      broker.emit('ready', {})
    }

    prepareSandbox()

    return () => {
      cancelled = true
      if (abortController) abortController.abort()
      broker.unregisterAll()
      if (prepRef.current) prepRef.current.textContent = ''
    }
  }, [])

  return (
    <div
      ref={prepRef}
      className="prepHTMLOutput"
    />
  )
}
