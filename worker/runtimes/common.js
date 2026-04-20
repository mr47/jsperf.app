/**
 * Shared benchmark loop logic.
 *
 * The runtime-specific builders (node.js, deno.js, bun.js) wrap this logic
 * in their own preamble (imports, GC exposure, etc.) and emit a complete
 * standalone script that runs inside a Docker container.
 *
 * The benchmark loop is time-sliced: each "slice" runs the test function
 * as many times as fit in SLICE_MS, then records the per-iteration latency.
 * This matches the structure of the existing QuickJS and V8-Sandbox engines
 * so that results are directly comparable.
 */

export const SLICE_MS = 200

/**
 * Returns a JS source string containing the shared benchmark loop body.
 * The wrapping runtime provides:
 *   - performance.now() (or equivalent high-res timer)
 *   - the user's setup code (already executed)
 *   - a global function __benchFn() to call
 *   - the value TIME_LIMIT (in ms)
 *   - a function emitResult(obj) that writes a single JSON line to stdout
 *   - optional gcBefore() / gcAfter() / collectMemory() helpers
 *
 * The loop returns a result object via emitResult().
 */
export function benchmarkLoopSource() {
  return `
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runBenchmark() {
  if (typeof gcBefore === 'function') gcBefore();
  const memBefore = typeof collectMemory === 'function' ? collectMemory() : null;

  const samples = [];
  let iterations = 0;
  const startMs = performance.now();
  let elapsed = 0;

  while (elapsed < TIME_LIMIT) {
    const sliceStart = performance.now();
    let sliceIters = 0;

    while (performance.now() - sliceStart < ${SLICE_MS}) {
      __benchFn();
      sliceIters++;
    }

    const sliceElapsed = performance.now() - sliceStart;
    if (sliceIters > 0 && sliceElapsed > 0) {
      samples.push({ iters: sliceIters, ms: sliceElapsed });
    }

    iterations += sliceIters;
    elapsed = performance.now() - startMs;
  }

  const totalMs = performance.now() - startMs;

  if (typeof gcAfter === 'function') gcAfter();
  const memAfter = typeof collectMemory === 'function' ? collectMemory() : null;

  const latencies = samples.map(s => s.ms / s.iters).sort((a, b) => a - b);
  const mean = latencies.length > 0
    ? latencies.reduce((s, v) => s + v, 0) / latencies.length
    : 0;
  const opsPerSec = mean > 0 ? 1000 / mean : 0;

  emitResult({
    state: 'completed',
    opsPerSec: Math.round(opsPerSec),
    iterations,
    totalMs,
    latency: {
      mean,
      p50: percentile(latencies, 0.5),
      p99: percentile(latencies, 0.99),
      min: latencies.length > 0 ? latencies[0] : 0,
      max: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
      samplesCount: samples.length,
    },
    memory: { before: memBefore, after: memAfter },
  });
}
`
}

/**
 * Wraps user-supplied teardown code (string) in a try/catch so a broken
 * teardown does not fail the entire run. Returns a JS source snippet.
 */
export function teardownSource(teardown) {
  if (!teardown) return ''
  return `
try {
  ${teardown}
} catch (__teardownErr) {
  // teardown errors are non-fatal; benchmark result is already emitted
}
`
}

/**
 * Wraps the error-emit branch so unhandled errors produce a structured
 * JSON result (instead of the container exiting with a stack trace).
 */
export function errorTrapSource() {
  return `
function __emitError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  emitResult({
    state: 'errored',
    error: msg,
    opsPerSec: 0,
    latency: null,
    memory: null,
  });
}
`
}
