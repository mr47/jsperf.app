import { useEffect } from 'react'
import PostMessageBroker from '../utils/postMessageBroker'
import { getRanked, formatNumber } from '../utils/ArrayUtils'
import { runBenchmark } from '../utils/benchmark'

function compileFactory(code, setup, teardown, isAsync) {
  try {
    const testBody = isAsync
      ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${code}\n})`
      : code

    const body = `
      ${setup || ''}
      var __testFn = function() { ${testBody} };
      var __teardownFn = function() { ${teardown || ''} };
      return { test: __testFn, teardown: __teardownFn };
    `
    const factory = new Function(body)
    factory()
    return { factory, error: null }
  } catch (e) {
    return { factory: null, error: e }
  }
}

export default (props) => {
  const {
    pageData: { tests, initHTML, setup, teardown },
  } = props

  useEffect(() => {
    let cancelled = false
    let abortController = null

    const broker = new PostMessageBroker(
      typeof window !== 'undefined' && window.parent !== window
        ? window.parent
        : window
    )

    const factories = tests.map((test) =>
      compileFactory(test.code, setup, teardown, test.async)
    )

    broker.emit('ready', {})

    broker.register('run', async (event) => {
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

      for (let i = 0; i < tests.length; i++) {
        if (signal.aborted) break

        if (factories[i].error) {
          benchResults.push({ index: i, result: { state: 'errored', error: factories[i].error } })
          continue
        }

        let compiled
        try {
          compiled = factories[i].factory()
        } catch (e) {
          factories[i].error = e
          benchResults.push({ index: i, result: { state: 'errored', error: e } })
          continue
        }

        const taskIndex = benchResults.filter(
          (r) => r.result.state !== 'errored'
        ).length

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
          isAsync: !!tests[i].async,
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
          status: 'completed',
          running: true,
        })
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
            status: 'error', error: factories[i].error.message, percent: '—',
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

    return () => {
      cancelled = true
      if (abortController) abortController.abort()
    }
  }, [])

  return (
    <div
      className="prepHTMLOutput"
      dangerouslySetInnerHTML={{ __html: initHTML }}
    />
  )
}
