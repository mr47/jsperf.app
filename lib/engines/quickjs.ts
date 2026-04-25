// @ts-nocheck
/**
 * QuickJS-WASM benchmark engine using quickjs-wasi.
 *
 * Runs benchmark code in a deterministic QuickJS interpreter compiled to WASM.
 * No JIT, no GC heuristics, no background threads -- results are purely
 * algorithmic and reproducible.
 *
 * Uses the host's performance.now() for timing (injected as a host function)
 * since QuickJS's own timer is low-resolution.
 */

import { QuickJS } from 'quickjs-wasi'
import { computeBenchmarkStats, METHODOLOGY_VERSION } from '../benchmark/stats'

const DEFAULT_TIME_MS = 2000
const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024 // 64MB
const SLICE_MS = 200

/**
 * Run a benchmark in QuickJS-WASM.
 *
 * @param {string} code - The benchmark code to execute (function body)
 * @param {object} opts
 * @param {string} [opts.setup] - Setup code run once before benchmarking
 * @param {string} [opts.teardown] - Teardown code run once after benchmarking
 * @param {number} [opts.timeMs=2000] - Total benchmark time in ms
 * @param {number} [opts.memoryLimit] - WASM memory limit in bytes
 * @param {boolean} [opts.isAsync=false] - Async snippets are reported unsupported
 * @returns {Promise<{ opsPerSec: number, memoryUsed: object, latency: object, state: string }>}
 */
export async function runInQuickJS(code, {
  setup,
  teardown,
  timeMs = DEFAULT_TIME_MS,
  memoryLimit = DEFAULT_MEMORY_LIMIT,
  isAsync = false,
} = {}) {
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
    const deadline = Date.now() + timeMs + 5000 // hard safety margin

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

    // Inject host timer: QuickJS has performance.now() via Intrinsics.PERFORMANCE,
    // but we inject a host-side one for guaranteed high-resolution timing
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

    // Run setup
    if (setup) {
      try {
        vm.evalCode(setup, '<setup>')
      } catch (e) {
        return { state: 'errored', error: `Setup error: ${e.message}`, opsPerSec: 0, latency: null, memoryUsed: null }
      }
    }

    // Compile the test function
    let testFnSource
    try {
      testFnSource = `(function __benchFn() {\n${code}\n})`
      vm.evalCode(`globalThis.__benchFn = ${testFnSource}`, '<compile>')
    } catch (e) {
      return { state: 'errored', error: `Compile error: ${e.message}`, opsPerSec: 0, latency: null, memoryUsed: null }
    }

    // Run the benchmark loop inside QuickJS, timed from the host
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

    // Run teardown
    if (teardown) {
      try { vm.evalCode(teardown, '<teardown>') } catch (_) { /* ignore */ }
    }

    // Parse results
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
