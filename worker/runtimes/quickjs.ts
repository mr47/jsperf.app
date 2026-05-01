/**
 * QuickJS-WASM runner for donor worker-side analysis.
 *
 * Mirrors the app-side QuickJS profile shape so Vercel can feed these
 * profiles into the existing prediction/finalization pipeline unchanged.
 */
import { QuickJS } from 'quickjs-wasi'
import { computeBenchmarkStats, METHODOLOGY_VERSION } from './stats.js'

const DEFAULT_TIME_MS = 2000
const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024
const SLICE_MS = 200

const QUICKJS_MEMORY_PROFILES = [
  { label: '0.5x', resourceLevel: 0.5, memoryLimit: 8 * 1024 * 1024 },
  { label: '1x', resourceLevel: 1, memoryLimit: 16 * 1024 * 1024 },
  { label: '2x', resourceLevel: 2, memoryLimit: 32 * 1024 * 1024 },
  { label: '4x', resourceLevel: 4, memoryLimit: 64 * 1024 * 1024 },
]

export async function runQuickJSAnalysis(tests: any[], {
  setup,
  teardown,
  timeMs = DEFAULT_TIME_MS,
  signal,
}: any = {}) {
  const allProfiles = []

  for (let i = 0; i < tests.length; i++) {
    throwIfAborted(signal)

    const profiles = []
    for (const profile of QUICKJS_MEMORY_PROFILES) {
      throwIfAborted(signal)

      const qjsResult = await runInQuickJS(tests[i].code, {
        setup,
        teardown,
        timeMs: Math.min(timeMs, 1500),
        memoryLimit: profile.memoryLimit,
        isAsync: isAsyncTest(tests[i]),
      })

      profiles.push({
        label: profile.label,
        resourceLevel: profile.resourceLevel,
        memoryMB: profile.memoryLimit / (1024 * 1024),
        opsPerSec: qjsResult.opsPerSec || 0,
        latency: qjsResult.latency || null,
        methodology: qjsResult.methodology || null,
        memoryUsed: qjsResult.memoryUsed,
        state: qjsResult.state,
        error: qjsResult.error,
      })
    }

    allProfiles.push(profiles)
  }

  return allProfiles
}

export async function runInQuickJS(code: string, {
  setup,
  teardown,
  timeMs = DEFAULT_TIME_MS,
  memoryLimit = DEFAULT_MEMORY_LIMIT,
  isAsync = false,
}: any = {}) {
  if (isAsync) {
    return {
      state: 'unsupported',
      error: 'QuickJS-WASM deep analysis does not support async benchmark snippets yet.',
      opsPerSec: 0,
      latency: null,
      memoryUsed: null,
      methodology: { version: METHODOLOGY_VERSION, async: false },
    }
  }

  let vm
  try {
    let interrupted = false
    const deadline = Date.now() + timeMs + 5000

    vm = await QuickJS.create({
      memoryLimit,
      interruptHandler() {
        if (Date.now() > deadline) {
          interrupted = true
          return true
        }
        return false
      },
    })

    vm.newFunction('__hostNow', () => vm.newNumber(performance.now()))
      .consume(fn => vm.setProp(vm.global, '__hostNow', fn))

    vm.evalCode(`
      globalThis.console = {
        log: function() {},
        info: function() {},
        warn: function() {},
        error: function() {},
        debug: function() {}
      };
    `, '<console-shim>')

    if (setup) {
      try {
        vm.evalCode(setup, '<setup>')
      } catch (e) {
        return { state: 'errored', error: `Setup error: ${e.message}`, opsPerSec: 0, latency: null, memoryUsed: null }
      }
    }

    try {
      vm.evalCode(`globalThis.__benchFn = (function __benchFn() {\n${code}\n})`, '<compile>')
    } catch (e) {
      return { state: 'errored', error: `Compile error: ${e.message}`, opsPerSec: 0, latency: null, memoryUsed: null }
    }

    const benchScript = `
      (function() {
        var fn = globalThis.__benchFn;
        var iterations = 0;
        var startMs = __hostNow();
        var elapsed = 0;
        var timeLimit = ${timeMs};
        var sliceLimit = ${SLICE_MS};
        var samples = [];

        while (elapsed < timeLimit) {
          var sliceStart = __hostNow();
          var sliceIters = 0;

          while (__hostNow() - sliceStart < sliceLimit) {
            fn();
            sliceIters++;
          }

          var sliceElapsed = __hostNow() - sliceStart;
          if (sliceIters > 0 && sliceElapsed > 0) {
            samples.push({ iters: sliceIters, ms: sliceElapsed });
          }

          iterations += sliceIters;
          elapsed = __hostNow() - startMs;
        }

        var totalMs = __hostNow() - startMs;
        return JSON.stringify({ iterations: iterations, totalMs: totalMs, samples: samples });
      })()
    `

    let resultJson
    try {
      const handle = vm.evalCode(benchScript, '<bench>')
      resultJson = vm.dump(handle)
      handle.dispose()
    } catch (e) {
      if (interrupted) {
        return { state: 'timeout', error: 'Execution timed out', opsPerSec: 0, latency: null, memoryUsed: null }
      }
      return { state: 'errored', error: `Runtime error: ${e.message}`, opsPerSec: 0, latency: null, memoryUsed: null }
    }

    if (teardown) {
      try { vm.evalCode(teardown, '<teardown>') } catch (_) { /* ignore */ }
    }

    const parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson
    const { iterations, totalMs, samples } = parsed
    const memoryUsed = vm.getMemoryUsage()
    const stats = computeBenchmarkStats(samples, { iterations, totalMs, sliceMs: SLICE_MS })

    return {
      state: interrupted ? 'timeout' : 'completed',
      ...stats,
      memoryUsed: {
        totalBytes: memoryUsed.memoryUsedSize,
        objectCount: memoryUsed.objCount,
        stringCount: memoryUsed.strCount,
        functionCount: memoryUsed.jsFuncCount,
      },
    }
  } catch (e) {
    return { state: 'errored', error: e.message || String(e), opsPerSec: 0, latency: null, memoryUsed: null }
  } finally {
    if (vm) {
      try { vm.dispose() } catch (_) { /* already disposed */ }
    }
  }
}

function isAsyncTest(test: any) {
  if (test?.async === true) return true
  const code = String(test?.code || '')
  return (
    code.includes('deferred.resolve') ||
    code.includes('await ') ||
    code.includes('return new Promise')
  )
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}
