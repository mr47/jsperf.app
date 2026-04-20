/**
 * V8 benchmark engine using Vercel Sandbox (Firecracker microVM).
 *
 * Runs benchmark code inside a real V8 engine (Node.js 24) in an isolated
 * Firecracker microVM. Provides realistic JIT-optimized performance data
 * with heap statistics.
 *
 * Each benchmark gets its own sandbox with network access disabled.
 * Supports snapshot-based fast boot for repeated analyses.
 */

import { Sandbox } from '@vercel/sandbox'

const DEFAULT_TIME_MS = 2000
const SANDBOX_TIMEOUT_MS = 60_000
// Server-side TTL is the safety net: even if our stop() call is dropped or
// the parent function dies before finally runs, Vercel reaps the sandbox
// after this many ms. Keep the local stop() call as the primary cleanup.
const STOP_TIMEOUT_MS = 5_000

/**
 * Best-effort sandbox teardown with bounded wait + visibility.
 *
 * Default behavior of `try { await sandbox.stop() } catch {}` swallows
 * failures silently, so orphaned sandboxes only get reaped when their
 * server-side timeout fires. We instead:
 *   - cap the stop() wait at STOP_TIMEOUT_MS so a hung API call cannot
 *     extend the parent function's lifetime;
 *   - log (warn) on failure so leaks become observable in production logs.
 */
async function stopSandbox(sandbox) {
  if (!sandbox) return
  try {
    await Promise.race([
      sandbox.stop(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('sandbox.stop() timeout')), STOP_TIMEOUT_MS)
      ),
    ])
  } catch (e) {
    console.warn('[v8sandbox] failed to stop sandbox:', e?.message || e)
  }
}

/**
 * Build the Node.js benchmark script that runs inside the sandbox.
 * Outputs a single JSON line to stdout with results.
 */
function buildBenchmarkScript(code, { setup, teardown, timeMs }) {
  return `
'use strict';
const v8 = require('v8');
const { performance } = require('perf_hooks');

const SLICE_MS = 200;
const TIME_LIMIT = ${timeMs};

async function main() {
  // Setup
  ${setup ? setup : ''}

  // Compile test function — eval preserves access to setup's local scope,
  // unlike new Function() which only sees global scope
  const __benchCode = ${JSON.stringify(code)};
  const __benchFn = eval('(function() {\\n' + __benchCode + '\\n})');

  // Force GC before measurement if available
  if (typeof gc === 'function') gc();

  const heapBefore = process.memoryUsage();
  const v8HeapBefore = v8.getHeapStatistics();

  // Benchmark loop
  let iterations = 0;
  const samples = [];
  const startMs = performance.now();
  let elapsed = 0;

  while (elapsed < TIME_LIMIT) {
    const sliceStart = performance.now();
    let sliceIters = 0;

    while (performance.now() - sliceStart < SLICE_MS) {
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

  // Teardown
  ${teardown ? teardown : ''}

  // Collect heap stats
  if (typeof gc === 'function') gc();
  const heapAfter = process.memoryUsage();
  const v8HeapAfter = v8.getHeapStatistics();

  // Compute per-iteration latency stats
  const latencies = samples.map(s => s.ms / s.iters).sort((a, b) => a - b);
  const mean = latencies.length > 0
    ? latencies.reduce((s, v) => s + v, 0) / latencies.length
    : 0;
  const opsPerSec = mean > 0 ? 1000 / mean : 0;

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  const result = {
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
    heapUsed: heapAfter.heapUsed,
    heapTotal: v8HeapAfter.total_heap_size,
    externalMemory: heapAfter.external,
    heapDelta: heapAfter.heapUsed - heapBefore.heapUsed,
  };

  process.stdout.write(JSON.stringify(result) + '\\n');
}

main().catch(err => {
  process.stdout.write(JSON.stringify({
    state: 'errored',
    error: err.message || String(err),
    opsPerSec: 0,
    latency: null,
  }) + '\\n');
  process.exit(1);
});
`
}

/**
 * Run a benchmark in a Vercel Sandbox (Firecracker microVM with V8).
 *
 * @param {string} code - The benchmark code to execute (function body)
 * @param {object} opts
 * @param {string} [opts.setup] - Setup code run once before benchmarking
 * @param {string} [opts.teardown] - Teardown code run once after benchmarking
 * @param {number} [opts.timeMs=2000] - Total benchmark time in ms
 * @param {string} [opts.snapshotId] - Restore from a pre-configured sandbox snapshot
 * @param {number} [opts.vcpus=1] - Number of vCPUs (1-4)
 * @param {AbortSignal} [opts.signal] - Cancel the run; the in-flight sandbox
 *   will still be stopped via the finally block.
 * @returns {Promise<{ opsPerSec: number, heapUsed: number, latency: object, state: string }>}
 */
export async function runInV8Sandbox(code, {
  setup,
  teardown,
  timeMs = DEFAULT_TIME_MS,
  snapshotId,
  vcpus = 1,
  signal,
} = {}) {
  let sandbox
  try {
    const createParams = {
      timeout: SANDBOX_TIMEOUT_MS,
      networkPolicy: 'deny-all',
      resources: { vcpus },
    }

    if (snapshotId) {
      createParams.source = { type: 'snapshot', snapshotId }
    } else {
      createParams.runtime = 'node24'
    }

    sandbox = await Sandbox.create(createParams)

    const script = buildBenchmarkScript(code, { setup, teardown, timeMs })

    await sandbox.writeFiles([
      { path: '/tmp/bench.js', content: script },
    ])

    // Combine the parent abort (analyze function timeout / client disconnect)
    // with the per-run timeout so either source kills the sandbox process.
    const runSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeMs + 10_000)])
      : AbortSignal.timeout(timeMs + 10_000)

    const result = await sandbox.runCommand('node', ['--expose-gc', '/tmp/bench.js'], {
      signal: runSignal,
    })

    const stdoutText = await result.stdout()
    const stderrText = await result.stderr()

    if (result.exitCode !== 0) {
      // The benchmark script writes error JSON to stdout before exiting
      if (stdoutText) {
        try {
          const parsed = JSON.parse(stdoutText.trim())
          if (parsed.state === 'errored' && parsed.error) {
            return { ...parsed, heapUsed: parsed.heapUsed || 0 }
          }
        } catch (_) { /* not valid JSON, fall through */ }
      }

      return {
        state: 'errored',
        error: stderrText || `Process exited with code ${result.exitCode}`,
        opsPerSec: 0,
        latency: null,
        heapUsed: 0,
      }
    }

    const parsed = JSON.parse(stdoutText.trim())
    return parsed

  } catch (e) {
    return {
      state: 'errored',
      error: e.message || String(e),
      opsPerSec: 0,
      latency: null,
      heapUsed: 0,
    }
  } finally {
    await stopSandbox(sandbox)
  }
}

/**
 * Create a sandbox snapshot with benchmark harness pre-installed.
 * Call once, store the snapshot ID, and use it for all future analyses.
 *
 * @returns {Promise<string>} snapshot ID
 */
export async function createBenchmarkSnapshot() {
  let sandbox
  try {
    sandbox = await Sandbox.create({
      runtime: 'node24',
      timeout: 120_000,
      networkPolicy: 'deny-all',
    })
    await sandbox.runCommand('node', ['--version'])
    const snapshot = await sandbox.snapshot()
    return snapshot.snapshotId
  } finally {
    // Always stop. Previously we only stopped on error; the success path
    // returned with a still-running sandbox, leaking it until the
    // server-side timeout fired.
    await stopSandbox(sandbox)
  }
}
