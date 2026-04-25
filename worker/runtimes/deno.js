/**
 * Deno benchmark script builder.
 *
 * Produces a complete standalone Deno script. Deno uses the same V8 engine
 * as Node but exposes a different API surface (Deno.* globals, web standards).
 *
 * Run with: deno run --allow-hrtime --v8-flags=--expose-gc /bench.js
 */

import { benchmarkLoopSource, teardownSource, errorTrapSource } from './common.js'

export function buildDenoScript({ code, setup, teardown, timeMs, isAsync }) {
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
  const line = JSON.stringify(obj) + '\\n';
  Deno.stdout.writeSync(new TextEncoder().encode(line));
}

const __gc = (globalThis).gc;
function gcBefore() {
  if (typeof __gc === 'function') __gc();
}
function gcAfter() {
  if (typeof __gc === 'function') __gc();
}
function collectMemory() {
  const mem = Deno.memoryUsage();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
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
  Deno.exit(1);
});
`
}
