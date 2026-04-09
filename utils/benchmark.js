/**
 * Multi-pass benchmark runner built on tinybench.
 *
 * For fast sync functions, wraps them in calibrated batches so that
 * performance.now() overhead is amortised across many calls — matching
 * the approach Benchmark.js used to reach 100M+ ops/sec readings.
 *
 * Each tinybench pass blocks for at most ~200ms.  Between passes the
 * event loop is yielded so postMessage progress updates reach the
 * parent frame.  Statistics are merged across passes via the parallel
 * variance algorithm (no raw-sample storage → no OOM risk).
 */

import { Bench } from 'tinybench'

const SLICE_MS = 200

// Student's t-distribution critical values (95% CI, two-tailed)
const T_TABLE = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
  16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.060, 30: 2.042, 35: 2.030, 40: 2.021, 45: 2.014,
  50: 2.009, 60: 2.000, 70: 1.994, 80: 1.990, 90: 1.987,
  100: 1.984, 120: 1.980,
}

function tValue(df) {
  if (df <= 0) return 1.96
  if (T_TABLE[df]) return T_TABLE[df]
  if (df > 120) return 1.96
  const keys = Object.keys(T_TABLE).map(Number).sort((a, b) => a - b)
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i] <= df && keys[i + 1] >= df) {
      const lo = keys[i], hi = keys[i + 1]
      const frac = (df - lo) / (hi - lo)
      return T_TABLE[lo] + frac * (T_TABLE[hi] - T_TABLE[lo])
    }
  }
  return 1.96
}

const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 0))

/**
 * Run `fn` using tinybench in multiple ~200ms passes with automatic
 * iteration batching for fast sync functions.
 *
 * @param {Function} fn          The function to benchmark.
 * @param {object}   opts
 * @param {number}   opts.time      Total benchmark time in ms (default 5000).
 * @param {boolean}  opts.isAsync   Whether `fn` returns a Promise.
 * @param {AbortSignal} opts.signal Optional abort signal.
 * @param {Function} opts.onProgress  (elapsed, samples, runs, currentHz).
 * @returns {Promise<object>}  Statistics result object.
 */
export async function runBenchmark(fn, { time = 5000, isAsync = false, signal, onProgress } = {}) {
  // ── calibrate batch size (sync only) ──
  // For fast functions, batching many calls per timing measurement
  // amortises the ~50-100ns performance.now() overhead.
  let itersPerSample = 1

  if (!isAsync) {
    try {
      const calStart = performance.now()
      let calIters = 0
      while (performance.now() - calStart < 10 && calIters < 1e6) {
        fn()
        calIters++
      }
      const calElapsed = performance.now() - calStart
      if (calElapsed > 0 && calIters > 1) {
        // Target ~1ms per sample measurement; cap at 100k so no
        // single batch exceeds ~10ms even if fn slows down at scale.
        itersPerSample = Math.max(1, Math.min(100_000, Math.round(calIters / calElapsed)))
      }
    } catch (e) {
      return { state: 'errored', error: e }
    }
    await yieldToEventLoop()
    if (signal?.aborted) return { state: 'aborted' }
  }

  // ── setup tinybench ──
  const sliceTime = Math.min(time, SLICE_MS)

  const benchFn = itersPerSample > 1
    ? () => { for (let j = 0; j < itersPerSample; j++) fn() }
    : fn

  const bench = new Bench({
    time: sliceTime,
    warmup: false,
    warmupTime: 100,
    warmupIterations: 5,
    throws: false,
  })

  bench.add('__task', benchFn, isAsync ? { async: true } : undefined)
  const task = bench.getTask('__task')

  // ── warmup (once, using batched fn so JIT sees real call pattern) ──
  try {
    await task.warmup()
  } catch (e) {
    return { state: 'errored', error: e }
  }
  await yieldToEventLoop()
  if (signal?.aborted) return { state: 'aborted' }

  // ── multi-pass measurement (values kept in batch units) ──
  let totalSamples = 0
  let totalBatchRuns = 0
  let weightedBatchMeanSum = 0
  let pooledBatchVarNumer = 0
  let globalBatchMin = Infinity
  let globalBatchMax = -Infinity
  let lastResult = null

  const startTime = performance.now()

  while (performance.now() - startTime < time && !signal?.aborted) {
    task.reset(false)

    try {
      await task.run()
    } catch (e) {
      if (totalSamples === 0) return { state: 'errored', error: e }
      break
    }

    const r = task.result
    if (!r || r.state === 'errored') {
      if (totalSamples === 0) return { state: 'errored', error: r?.error || new Error('Unknown error') }
      break
    }

    if (r.state === 'completed' || r.state === 'aborted-with-statistics') {
      const n = r.latency.samplesCount
      const batchMean = r.latency.mean
      const batchVariance = r.latency.variance

      // Merge via parallel/Welford algorithm (batch units)
      if (totalSamples > 0) {
        const delta = batchMean - weightedBatchMeanSum / totalSamples
        pooledBatchVarNumer += (n - 1) * batchVariance + (totalSamples * n * delta ** 2) / (totalSamples + n)
      } else {
        pooledBatchVarNumer = (n - 1) * batchVariance
      }

      weightedBatchMeanSum += n * batchMean
      totalSamples += n
      totalBatchRuns += task.runs
      if (r.latency.min < globalBatchMin) globalBatchMin = r.latency.min
      if (r.latency.max > globalBatchMax) globalBatchMax = r.latency.max
      lastResult = r
    }

    if (onProgress) {
      const elapsed = performance.now() - startTime
      const currentHz = (lastResult?.throughput?.mean || 0) * itersPerSample
      onProgress(elapsed, totalSamples, totalBatchRuns * itersPerSample, currentHz)
    }

    await yieldToEventLoop()
  }

  if (signal?.aborted && totalSamples === 0) return { state: 'aborted' }
  if (totalSamples === 0) return { state: 'errored', error: new Error('No samples collected') }

  // ── build combined per-iteration statistics ──
  // Tinybench measured batches of N iterations. Scale all absolute
  // latency values by 1/N and variance by 1/N² to get per-call values.
  // RME is invariant to this scaling (it's a ratio).
  const N = itersPerSample
  const mean = (weightedBatchMeanSum / totalSamples) / N
  const batchVariance = totalSamples > 1 ? pooledBatchVarNumer / (totalSamples - 1) : 0
  const variance = batchVariance / (N * N)
  const sd = Math.sqrt(variance)
  const sem = totalSamples > 1 ? sd / Math.sqrt(totalSamples) : 0
  const df = Math.max(totalSamples - 1, 1)
  const critical = tValue(df)
  const moe = sem * critical
  const rme = mean > 0 ? (moe / mean) * 100 : 0
  const throughputMean = mean > 0 ? 1000 / mean : Infinity

  // Percentiles / min / max: scale from batch to per-iteration
  const lr = lastResult?.latency || {}
  const s = 1 / N

  return {
    state: signal?.aborted ? 'aborted-with-statistics' : 'completed',
    latency: {
      mean, sd, sem, variance, moe, rme,
      min: globalBatchMin === Infinity ? 0 : globalBatchMin * s,
      max: globalBatchMax === -Infinity ? 0 : globalBatchMax * s,
      p50: (lr.p50 ?? 0) * s || mean,
      p75: (lr.p75 ?? 0) * s || mean,
      p99: (lr.p99 ?? 0) * s || mean,
      p995: (lr.p995 ?? 0) * s || mean,
      p999: (lr.p999 ?? 0) * s || mean,
      mad: (lr.mad ?? 0) * s,
      aad: (lr.aad ?? 0) * s,
      df, critical, samplesCount: totalSamples,
    },
    throughput: { mean: throughputMean },
    totalTime: weightedBatchMeanSum / N,
    period: mean,
  }
}
