/**
 * Node.js benchmark script builder.
 *
 * Produces a complete standalone Node.js script that:
 *   1. Runs user setup code
 *   2. Compiles the test snippet via eval (to preserve setup's local scope)
 *   3. Runs the shared benchmark loop
 *   4. Emits a single JSON line to stdout with results + V8 heap stats
 *
 * Run with: node --expose-gc /bench.js
 */

import { benchmarkLoopSource, teardownSource, errorTrapSource } from './common.js'

export function buildNodeScript({ code, setup, teardown, timeMs, isAsync }) {
  const isLegacyAsync = code.includes('deferred.resolve')
  const isModernAsync = code.includes('await ') || code.includes('return new Promise')
  const shouldAwait = Boolean(isAsync || isLegacyAsync || isModernAsync)
  const testBody = isLegacyAsync
    ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${code}\n})`
    : code

  return `'use strict';
const v8 = require('v8');
const { performance } = require('perf_hooks');

const TIME_LIMIT = ${timeMs};
const IS_ASYNC = ${shouldAwait ? 'true' : 'false'};

function emitResult(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function gcBefore() {
  if (typeof gc === 'function') gc();
}
function gcAfter() {
  if (typeof gc === 'function') gc();
}
function collectMemory() {
  const mem = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: heap.total_heap_size,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  };
}

${errorTrapSource()}

async function main() {
  ${setup ? setup : ''}

  const __benchCode = ${JSON.stringify(testBody)};
  const __benchPrefix = ${shouldAwait && !isLegacyAsync ? JSON.stringify('async ') : JSON.stringify('')};
  const __benchFn = eval('(' + __benchPrefix + 'function() {\\n' + __benchCode + '\\n})');

  ${benchmarkLoopSource()}

  await runBenchmark();

  ${teardownSource(teardown)}
}

main().catch(err => {
  __emitError(err);
  process.exit(1);
});
`
}
