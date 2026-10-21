// @ts-nocheck
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

import { benchmarkStatsSource } from './stats.js'

export const SLICE_MS = 200

export function benchmarkFunctionParts({ code, isAsync }) {
  const source = typeof code === 'string' ? code : ''
  const isLegacyAsync = source.includes('deferred.resolve')
  const isModernAsync = source.includes('await ') || source.includes('return new Promise')
  const shouldAwait = Boolean(isAsync || isLegacyAsync || isModernAsync)
  const testBody = isLegacyAsync
    ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${source}\n})`
    : source

  return {
    isLegacyAsync,
    shouldAwait,
    testBody,
    prefix: shouldAwait && !isLegacyAsync ? 'async ' : '',
  }
}

/**
 * Runs setup, builds the benchmark function and prepares teardown inside a
 * function compiled at runtime by the AsyncFunction constructor.
 *
 * User setup/teardown must never be spliced into the generated script as
 * raw source: a syntax error there (or a declaration that collides with a
 * harness name such as runBenchmark) would stop the whole script from
 * parsing, so the runtime would die with a bare stack trace before
 * __emitError could report anything. Compiling them at runtime turns those
 * failures into a regular structured error result.
 *
 * Function-constructor code is sloppy mode regardless of the caller, which
 * matches the browser engine (new Function) and QuickJS. That matters for
 * Deno, whose ES module scripts are always strict, and for Node's
 * 'use strict' harness: classic snippets such as `delete b` or `with` would
 * otherwise be SyntaxErrors only on the Docker runtimes.
 *
 * Setup, the benchmark function and teardown share one scope so setup's
 * locals stay visible to the test and teardown. Setup sits in its own block
 * so its declarations may shadow the scope's parameters. `require` is passed
 * through because it is module-scoped (not global) in CommonJS. Declares
 * __benchSource, __benchFn and __runTeardown in the caller's scope.
 */
export function evalUserCodeSource({ setup, teardown, parts }) {
  const setupBody = [
    '{',
    setup || '',
    ';return { __jsperfUserScope: true, benchFn: eval(__jsperfBenchSource), teardown: __jsperfTeardownSource ? (async () => { try { await eval(__jsperfTeardownSource); } catch (__teardownErr) {} }) : null };',
    '}',
  ].join('\n')
  const teardownScope = teardown ? `(async () => {\n${teardown}\n})()` : ''

  return `
const __benchCode = ${JSON.stringify(parts.testBody)};
const __benchPrefix = ${JSON.stringify(parts.prefix)};
const __benchSource = '(' + __benchPrefix + 'function jsperfUserBenchmark() {\\n' + __benchCode + '\\n})\\n//# sourceURL=jsperf-user-code.js';
const __teardownSource = ${JSON.stringify(teardownScope)};
const __AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let __enterUserScope;
try {
  __enterUserScope = new __AsyncFunction('__jsperfBenchSource', '__jsperfTeardownSource', 'require', ${JSON.stringify(setupBody)});
} catch (__setupErr) {
  if (__setupErr instanceof SyntaxError) {
    __setupErr.message = 'Setup code failed to parse: ' + __setupErr.message;
  }
  throw __setupErr;
}
const __userScope = await __enterUserScope(
  __benchSource,
  __teardownSource,
  typeof require === 'function' ? require : undefined,
);
if (!__userScope || __userScope.__jsperfUserScope !== true) {
  throw new Error('Setup code returned before the benchmark could start');
}
const __benchFn = __userScope.benchFn;
const __runTeardown = __userScope.teardown;
`
}

/**
 * Native TypeScript scripts can't go through eval (it only accepts
 * JavaScript), so they keep setup and the test function inline; their
 * sources were already validated by the TypeScript compiler upstream.
 */
export function userCodeSource({ setup, teardown, fnParts, nativeTypeScript }) {
  if (nativeTypeScript) {
    return `${setup ? setup : ''}\n${inlineBenchmarkFunctionSource(fnParts)}`
  }
  return evalUserCodeSource({ setup, teardown, parts: fnParts })
}

export function inlineBenchmarkFunctionSource(parts) {
  return `
const __benchFn = ${parts.prefix}function() {
${parts.testBody}
};
`
}

/**
 * Returns a JS source string containing the shared benchmark loop body.
 * The wrapping runtime provides:
 *   - performance.now() (or equivalent high-res timer)
 *   - the user's setup code (already executed)
 *   - a global function __benchFn() to call
 *   - the value IS_ASYNC, controlling whether __benchFn() is awaited
 *   - the value TIME_LIMIT (in ms)
 *   - a function emitResult(obj) that writes a single JSON line to stdout
 *   - optional gcBefore() / gcAfter() / collectMemory() helpers
 *
 * The loop returns a result object via emitResult().
 */
export function benchmarkLoopSource() {
  return `
${benchmarkStatsSource()}

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

  if (typeof gcAfter === 'function') gcAfter();
  const memAfter = typeof collectMemory === 'function' ? collectMemory() : null;

  const stats = computeBenchmarkStats(samples, { iterations, totalMs, sliceMs: ${SLICE_MS} });

  let result = {
    state: 'completed',
    ...stats,
    memory: { before: memBefore, after: memAfter },
  };

  if (typeof captureBenchmarkResult === 'function') {
    await captureBenchmarkResult(result);
    return;
  }

  if (typeof finalizeBenchmarkResult === 'function') {
    result = await finalizeBenchmarkResult(result);
  }

  emitResult(result);
}
`
}

/**
 * Wraps user-supplied teardown code (string) in a try/catch so a broken
 * teardown does not fail the entire run. Returns a JS source snippet. Only
 * used by the native TypeScript scripts, whose sources were already
 * validated by the TypeScript compiler; JavaScript scripts go through
 * evalUserCodeSource().
 */
export function teardownSource(teardown) {
  if (!teardown) return ''
  return `
try {
  ${teardown}
} catch (__teardownErr) {
  // teardown errors are non-fatal
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
