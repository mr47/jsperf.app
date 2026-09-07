/**
 * V8 benchmark engine using Vercel Sandbox (Firecracker microVM).
 *
 * Runs benchmark code inside a real V8 engine (Node.js 24) in an isolated
 * Firecracker microVM. Provides realistic JIT-optimized performance data
 * with heap statistics.
 *
 * Each benchmark gets its own sandbox with network access disabled.
 * Supports snapshot-based fast boot for repeated analyses.
 *
 * Credentials are resolved up front (see ./sandboxCredentials) and passed to
 * the SDK explicitly. When none are available the run is reported as
 * `state: 'unavailable'` with the reason, so Deep Analysis degrades to
 * QuickJS-only results instead of failing or hanging on the SDK's
 * interactive login flow.
 */

import { Sandbox } from '@vercel/sandbox'
import { benchmarkStatsSource } from '../benchmark/stats'
import {
  resolveSandboxCredentials,
  type SandboxCredentialResult,
  type SandboxCredentials,
} from './sandboxCredentials'

export { resolveSandboxCredentials } from './sandboxCredentials'
export type { SandboxCredentialResult, SandboxCredentials } from './sandboxCredentials'

const DEFAULT_TIME_MS = 2000
const SANDBOX_TIMEOUT_MS = 60_000
// Server-side TTL is the safety net: even if cleanup is dropped or the parent
// function dies before finally runs, Vercel reaps the sandbox after this many
// ms. Keep explicit deletion as the primary cleanup for benchmark runs.
const STOP_TIMEOUT_MS = 5_000
const DELETE_TIMEOUT_MS = 10_000
const VERCEL_API_BASE_URL = 'https://api.vercel.com'

export type V8BenchmarkState = 'completed' | 'errored' | 'unavailable'

export interface V8BenchmarkLatency {
  mean: number
  p50: number
  p99: number
  min: number
  max: number
  samplesCount: number
}

export interface V8BenchmarkResult {
  state: V8BenchmarkState
  opsPerSec: number
  latency: V8BenchmarkLatency | null
  heapUsed: number
  error?: string
  methodology?: unknown
  iterations?: number
  totalMs?: number
  heapTotal?: number
  externalMemory?: number
  heapDelta?: number
  [key: string]: unknown
}

export interface RunInV8SandboxOptions {
  /** Setup code run once before benchmarking. */
  setup?: string
  /** Teardown code run once after benchmarking. */
  teardown?: string
  /** Total benchmark time in ms. */
  timeMs?: number
  /** Restore from a pre-configured sandbox snapshot. */
  snapshotId?: string
  /** Number of vCPUs (1-4). */
  vcpus?: number
  /** Whether to await the benchmark function. */
  isAsync?: boolean
  /**
   * Cancel the run; the in-flight sandbox will still be removed via the
   * finally block.
   */
  signal?: AbortSignal
}

/**
 * Structural view of the SDK sandbox that this module relies on. The SDK
 * class has many more members; typing against the subset keeps the unit
 * tests' hand-rolled mocks honest without pinning us to one SDK major.
 */
interface SandboxHandle {
  name?: string
  sandboxId?: string
  id?: string
  writeFiles(files: Array<{ path: string; content: string | Buffer }>): Promise<unknown>
  runCommand(
    cmd: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>
  stop(opts?: { blocking?: boolean; signal?: AbortSignal }): Promise<unknown>
  delete?(opts?: { signal?: AbortSignal }): Promise<unknown>
  snapshot?(): Promise<{ snapshotId: string }>
}

type SandboxCreateParams = Parameters<typeof Sandbox.create>[0]

const loggedUnavailableReasons = new Set<string>()

/**
 * Resolve credentials and log the failure reason once per process so a
 * misconfigured local environment is visible in the dev server output without
 * repeating the message for every test in an analysis.
 */
async function preflightCredentials(): Promise<SandboxCredentialResult> {
  const result = await resolveSandboxCredentials()
  if (result.ok === false && !loggedUnavailableReasons.has(result.reason)) {
    loggedUnavailableReasons.add(result.reason)
    console.warn(`[v8sandbox] V8 sandbox unavailable (${result.code}): ${result.reason}`)
  }
  return result
}

function unavailableResult(reason: string): V8BenchmarkResult {
  return {
    state: 'unavailable',
    error: reason,
    opsPerSec: 0,
    latency: null,
    heapUsed: 0,
  }
}

function getSandboxDeleteName(sandbox: SandboxHandle): string | null {
  const name = sandbox.name || sandbox.sandboxId || sandbox.id
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name) ? name : null
}

async function deleteSandboxFromVercel(name: string, credentials: SandboxCredentials): Promise<boolean> {
  if (typeof fetch !== 'function') return false

  const url = new URL(`/v2/sandboxes/${encodeURIComponent(name)}`, VERCEL_API_BASE_URL)
  url.searchParams.set('projectId', credentials.projectId)
  url.searchParams.set('teamId', credentials.teamId)

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${credentials.token}`,
    },
    signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
  })

  if (response.ok || response.status === 410) return true
  if (response.status === 404) return false

  const body = await response.text().catch(() => '')
  throw new Error(`delete failed with ${response.status}${body ? `: ${body}` : ''}`)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Best-effort sandbox teardown with bounded wait + visibility.
 *
 * A plain `stop()` only triggers shutdown. Use the blocking variant so the
 * Vercel side has marked the sandbox stopped before the API handler returns.
 * We also:
 *   - cap the stop() wait at STOP_TIMEOUT_MS so a hung API call cannot
 *     extend the parent function's lifetime;
 *   - log (warn) on failure so leaks become observable in production logs.
 */
async function stopSandbox(sandbox: SandboxHandle | undefined): Promise<void> {
  if (!sandbox) return
  try {
    await sandbox.stop({
      blocking: true,
      signal: AbortSignal.timeout(STOP_TIMEOUT_MS),
    })
  } catch (e) {
    console.warn('[v8sandbox] failed to stop sandbox:', errorMessage(e))
  }
}

async function removeSandbox(sandbox: SandboxHandle | undefined, credentials: SandboxCredentials): Promise<void> {
  if (!sandbox) return

  try {
    if (typeof sandbox.delete === 'function') {
      await Promise.race([
        sandbox.delete({ signal: AbortSignal.timeout(DELETE_TIMEOUT_MS) }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sandbox.delete() timeout')), DELETE_TIMEOUT_MS)
        ),
      ])
      return
    }

    const name = getSandboxDeleteName(sandbox)
    if (name && await deleteSandboxFromVercel(name, credentials)) return
  } catch (e) {
    console.warn('[v8sandbox] failed to delete sandbox:', errorMessage(e))
  }

  await stopSandbox(sandbox)
}

/**
 * Build the Node.js benchmark script that runs inside the sandbox.
 * Outputs a single JSON line to stdout with results.
 */
function buildBenchmarkScript(
  code: string,
  { setup, teardown, timeMs, isAsync }: { setup?: string; teardown?: string; timeMs: number; isAsync: boolean },
): string {
  const isLegacyAsync = code.includes('deferred.resolve')
  const isModernAsync = code.includes('await ') || code.includes('return new Promise')
  const shouldAwait = Boolean(isAsync || isLegacyAsync || isModernAsync)
  const testBody = isLegacyAsync
    ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${code}\n})`
    : code

  return `
'use strict';
const v8 = require('v8');
const { performance } = require('perf_hooks');

const SLICE_MS = 200;
const TIME_LIMIT = ${timeMs};
const IS_ASYNC = ${shouldAwait ? 'true' : 'false'};

${benchmarkStatsSource()}

async function main() {
  // Setup
  ${setup ? setup : ''}

  // Compile test function — eval preserves access to setup's local scope,
  // unlike new Function() which only sees global scope
  const __benchCode = ${JSON.stringify(testBody)};
  const __benchPrefix = ${shouldAwait && !isLegacyAsync ? JSON.stringify('async ') : JSON.stringify('')};
  const __benchFn = eval('(' + __benchPrefix + 'function() {\\n' + __benchCode + '\\n})');

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
      if (IS_ASYNC) await __benchFn();
      else __benchFn();
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

  const stats = computeBenchmarkStats(samples, { iterations, totalMs, sliceMs: SLICE_MS });

  const result = {
    state: 'completed',
    ...stats,
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
 * Resolves credentials first. Without usable credentials the function
 * resolves to `{ state: 'unavailable', error }` immediately, without any
 * network call, so callers can keep the rest of the analysis going.
 *
 * @param code - The benchmark code to execute (function body)
 */
export async function runInV8Sandbox(code: string, {
  setup,
  teardown,
  timeMs = DEFAULT_TIME_MS,
  snapshotId,
  vcpus = 1,
  isAsync = false,
  signal,
}: RunInV8SandboxOptions = {}): Promise<V8BenchmarkResult> {
  const auth = await preflightCredentials()
  if (auth.ok === false) return unavailableResult(auth.reason)
  const { credentials } = auth

  let sandbox: SandboxHandle | undefined
  let parentAborted = false
  try {
    const createParams: SandboxCreateParams = {
      ...credentials,
      timeout: SANDBOX_TIMEOUT_MS,
      networkPolicy: 'deny-all',
      resources: { vcpus },
      ...(snapshotId
        ? { source: { type: 'snapshot', snapshotId } }
        : { runtime: 'node24' }),
    }

    sandbox = await Sandbox.create(createParams) as unknown as SandboxHandle

    const script = buildBenchmarkScript(code, { setup, teardown, timeMs, isAsync })

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
      // The benchmark script writes error JSON to stdout before exiting.
      // User snippets may also write to stdout, so parse the final JSON line
      // instead of the whole stream.
      if (stdoutText) {
        try {
          const parsed = parseStdoutResult(stdoutText)
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

    const parsed = parseStdoutResult(stdoutText)
    return parsed

  } catch (e) {
    if (signal?.aborted) {
      parentAborted = true
      throw abortReason(signal)
    }

    return {
      state: 'errored',
      error: errorMessage(e),
      opsPerSec: 0,
      latency: null,
      heapUsed: 0,
    }
  } finally {
    if (parentAborted) {
      // The API route is already racing its function deadline. Let the response
      // finish; sandbox TTL is the backup if this best-effort cleanup is cut off.
      void removeSandbox(sandbox, credentials).catch((e) => {
        console.warn('[v8sandbox] deferred cleanup failed:', errorMessage(e))
      })
    } else {
      await removeSandbox(sandbox, credentials)
    }
  }
}

function abortReason(signal: AbortSignal | undefined): Error | DOMException {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('Aborted', 'AbortError')
}

function parseStdoutResult(stdoutText: string): V8BenchmarkResult {
  const lines = String(stdoutText || '').trim().split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(lines[i])
      if (parsed && typeof parsed === 'object' && 'state' in parsed && (parsed as { state?: unknown }).state) {
        return parsed as V8BenchmarkResult
      }
    } catch {
      // Keep scanning; user benchmark code may have logged arbitrary text.
    }
  }
  throw new Error('Failed to parse benchmark result from sandbox stdout')
}

/**
 * Create a sandbox snapshot with benchmark harness pre-installed.
 * Call once, store the snapshot ID, and use it for all future analyses.
 *
 * Throws with the credential failure reason when Vercel Sandbox is not
 * configured; there is no meaningful fallback for snapshot creation.
 *
 * @returns snapshot ID
 */
export async function createBenchmarkSnapshot(): Promise<string> {
  const auth = await preflightCredentials()
  if (auth.ok === false) throw new Error(auth.reason)

  let sandbox: SandboxHandle | undefined
  try {
    sandbox = await Sandbox.create({
      ...auth.credentials,
      runtime: 'node24',
      timeout: 120_000,
      networkPolicy: 'deny-all',
    }) as unknown as SandboxHandle
    await sandbox.runCommand('node', ['--version'])
    if (typeof sandbox.snapshot !== 'function') {
      throw new Error('Sandbox snapshots are not supported by this SDK version')
    }
    const snapshot = await sandbox.snapshot()
    return snapshot.snapshotId
  } finally {
    // Always stop. Previously we only stopped on error; the success path
    // returned with a still-running sandbox, leaking it until the
    // server-side timeout fired.
    await stopSandbox(sandbox)
  }
}
