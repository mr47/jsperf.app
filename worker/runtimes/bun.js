/**
 * Bun benchmark script builder.
 *
 * Bun uses JavaScriptCore (JSC) instead of V8, which gives a fundamentally
 * different JIT and GC profile. This is the script's main reason for existing.
 *
 * Run with: bun run /bench.js
 */

import { benchmarkLoopSource, teardownSource, errorTrapSource } from './common.js'

export function buildBunScript({ code, setup, teardown, timeMs, isAsync }) {
  const isLegacyAsync = code.includes('deferred.resolve')
  const isModernAsync = code.includes('await ') || code.includes('return new Promise')
  const shouldAwait = Boolean(isAsync || isLegacyAsync || isModernAsync)
  const testBody = isLegacyAsync
    ? `return new Promise(function(__resolve) { var deferred = { resolve: __resolve };\n${code}\n})`
    : code

  return `
const TIME_LIMIT = ${timeMs};
const IS_ASYNC = ${shouldAwait ? 'true' : 'false'};

function emitResult(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

let __jscHeapStats = null;

function gcBefore() {
  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') Bun.gc(true);
}
function gcAfter() {
  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') Bun.gc(true);
}
function collectMemory() {
  const mem = process.memoryUsage();
  const out = {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
  };
  if (__jscHeapStats) {
    try {
      const j = __jscHeapStats();
      out.jsc = {
        heapSize: j.heapSize,
        heapCapacity: j.heapCapacity,
        objectCount: j.objectCount,
      };
    } catch (_) { /* ignore */ }
  }
  return out;
}

${errorTrapSource()}

async function main() {
  // Pull JSC heap stats lazily; bun:jsc is only available inside Bun.
  // Doing this inside main() (rather than top-level) keeps the generated
  // script parseable in plain Script mode for static analysis.
  try {
    const jsc = await import('bun:jsc');
    __jscHeapStats = jsc.heapStats;
  } catch (_) {
    // bun:jsc not available; fall back to process.memoryUsage only
  }

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
