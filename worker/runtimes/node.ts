// @ts-nocheck
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

import {
  benchmarkLoopSource,
  teardownSource,
  errorTrapSource,
  benchmarkFunctionParts,
  evalBenchmarkFunctionSource,
} from './common.js'

export function buildNodeScript({ code, setup, teardown, timeMs, isAsync, profiling }) {
  const fnParts = benchmarkFunctionParts({ code, isAsync })
  const enableCpuProfile = profiling?.nodeCpu === true

  return `'use strict';
const v8 = require('v8');
const { performance } = require('perf_hooks');

const TIME_LIMIT = ${timeMs};
const IS_ASYNC = ${fnParts.shouldAwait ? 'true' : 'false'};
const ENABLE_CPU_PROFILE = ${enableCpuProfile ? 'true' : 'false'};
const CPU_PROFILE_MAX_BYTES = 8 * 1024 * 1024;

let __cpuProfilerSession = null;
let __cpuProfileError = null;

function emitResult(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function inspectorPost(session, method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params || {}, (err, result) => {
      if (err) reject(err);
      else resolve(result || {});
    });
  });
}

async function startCpuProfile() {
  if (!ENABLE_CPU_PROFILE) return;

  try {
    const inspector = require('node:inspector');
    __cpuProfilerSession = new inspector.Session();
    __cpuProfilerSession.connect();
    await inspectorPost(__cpuProfilerSession, 'Profiler.enable');
    await inspectorPost(__cpuProfilerSession, 'Profiler.setSamplingInterval', { interval: 1000 });
    await inspectorPost(__cpuProfilerSession, 'Profiler.start');
  } catch (err) {
    __cpuProfileError = err && err.message ? err.message : String(err);
    try { __cpuProfilerSession && __cpuProfilerSession.disconnect(); } catch (_) {}
    __cpuProfilerSession = null;
  }
}

async function finalizeBenchmarkResult(result) {
  if (!ENABLE_CPU_PROFILE) return result;

  if (!__cpuProfilerSession) {
    return __cpuProfileError
      ? { ...result, cpuProfileError: __cpuProfileError }
      : result;
  }

  try {
    const stopped = await inspectorPost(__cpuProfilerSession, 'Profiler.stop');
    await inspectorPost(__cpuProfilerSession, 'Profiler.disable').catch(() => {});
    try { __cpuProfilerSession.disconnect(); } catch (_) {}
    __cpuProfilerSession = null;

    const profile = stopped && stopped.profile;
    if (!profile || !Array.isArray(profile.nodes)) {
      return { ...result, cpuProfileError: 'Profiler did not return a CPU profile' };
    }

    const encoded = JSON.stringify(profile);
    const sizeBytes = Buffer.byteLength(encoded);
    if (sizeBytes > CPU_PROFILE_MAX_BYTES) {
      return {
        ...result,
        cpuProfileError: 'CPU profile exceeded the 8MB capture limit',
        cpuProfileMeta: {
          format: 'cpuprofile',
          sizeBytes,
          nodeCount: profile.nodes.length,
          sampleCount: Array.isArray(profile.samples) ? profile.samples.length : 0,
        },
      };
    }

    return {
      ...result,
      cpuProfile: profile,
      cpuProfileMeta: {
        format: 'cpuprofile',
        sizeBytes,
        nodeCount: profile.nodes.length,
        sampleCount: Array.isArray(profile.samples) ? profile.samples.length : 0,
        startTime: profile.startTime || null,
        endTime: profile.endTime || null,
      },
    };
  } catch (err) {
    try { __cpuProfilerSession && __cpuProfilerSession.disconnect(); } catch (_) {}
    __cpuProfilerSession = null;
    return {
      ...result,
      cpuProfileError: err && err.message ? err.message : String(err),
    };
  }
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

  ${evalBenchmarkFunctionSource(fnParts)}

  ${benchmarkLoopSource()}

  await startCpuProfile();
  await runBenchmark();

  ${teardownSource(teardown)}
}

main().catch(err => {
  __emitError(err);
  process.exit(1);
});
`
}
