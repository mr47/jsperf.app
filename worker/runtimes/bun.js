/**
 * Bun benchmark script builder.
 *
 * Bun uses JavaScriptCore (JSC) instead of V8, which gives a fundamentally
 * different JIT and GC profile. This is the script's main reason for existing.
 *
 * Run with: bun run /bench.js
 */

import { benchmarkLoopSource, teardownSource, errorTrapSource } from './common.js'

export function buildBunScript({ code, setup, teardown, timeMs }) {
  return `
const TIME_LIMIT = ${timeMs};

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

  const __benchCode = ${JSON.stringify(code)};
  const __benchFn = eval('(function() {\\n' + __benchCode + '\\n})');

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
