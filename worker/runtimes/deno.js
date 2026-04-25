/**
 * Deno benchmark script builder.
 *
 * Produces a complete standalone Deno script. Deno uses the same V8 engine
 * as Node but exposes a different API surface (Deno.* globals, web standards).
 *
 * Run with: deno run --allow-hrtime --v8-flags=--expose-gc /bench.js
 */

import {
  benchmarkLoopSource,
  teardownSource,
  errorTrapSource,
  benchmarkFunctionParts,
  evalBenchmarkFunctionSource,
  inlineBenchmarkFunctionSource,
} from './common.js'

export function buildDenoScript({ code, setup, teardown, timeMs, isAsync, nativeTypeScript = false }) {
  const fnParts = benchmarkFunctionParts({ code, isAsync })
  const source = buildDenoSource({ setup, teardown, timeMs, fnParts, nativeTypeScript })
  return nativeTypeScript ? { source, extension: 'ts' } : source
}

function buildDenoSource({ setup, teardown, timeMs, fnParts, nativeTypeScript }) {
  return `
const TIME_LIMIT = ${timeMs};
const IS_ASYNC = ${fnParts.shouldAwait ? 'true' : 'false'};

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

  ${nativeTypeScript ? inlineBenchmarkFunctionSource(fnParts) : evalBenchmarkFunctionSource(fnParts)}

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
