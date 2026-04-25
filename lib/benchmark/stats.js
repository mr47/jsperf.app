export const METHODOLOGY_VERSION = 'slice-stats-v1'
export const DEFAULT_CONFIDENCE = 0.95

const T_TABLE_95 = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
  16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.060, 30: 2.042, 35: 2.030, 40: 2.021, 45: 2.014,
  50: 2.009, 60: 2.000, 70: 1.994, 80: 1.990, 90: 1.987,
  100: 1.984, 120: 1.980,
}

export function tValue95(df) {
  if (df <= 0) return 1.96
  if (T_TABLE_95[df]) return T_TABLE_95[df]
  if (df > 120) return 1.96

  const keys = Object.keys(T_TABLE_95).map(Number).sort((a, b) => a - b)
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]
    const hi = keys[i + 1]
    if (lo <= df && hi >= df) {
      const frac = (df - lo) / (hi - lo)
      return T_TABLE_95[lo] + frac * (T_TABLE_95[hi] - T_TABLE_95[lo])
    }
  }
  return 1.96
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

export function computeBenchmarkStats(samples, { iterations = 0, totalMs = 0, sliceMs = 200 } = {}) {
  const clean = Array.isArray(samples)
    ? samples.filter(s => s && s.iters > 0 && s.ms > 0)
    : []
  const latencies = clean.map(s => s.ms / s.iters).sort((a, b) => a - b)
  const n = latencies.length
  const totalIterations = iterations || clean.reduce((sum, s) => sum + s.iters, 0)
  const measuredMs = totalMs || clean.reduce((sum, s) => sum + s.ms, 0)
  const mean = totalIterations > 0 && measuredMs > 0
    ? measuredMs / totalIterations
    : n > 0
      ? latencies.reduce((sum, value) => sum + value, 0) / n
      : 0

  let variance = 0
  if (n > 1) {
    const sumSquares = latencies.reduce((sum, value) => sum + ((value - mean) ** 2), 0)
    variance = sumSquares / (n - 1)
  }

  const sd = Math.sqrt(variance)
  const sem = n > 1 ? sd / Math.sqrt(n) : 0
  const df = Math.max(n - 1, 1)
  const critical = tValue95(df)
  const moe = sem * critical
  const rme = mean > 0 ? (moe / mean) * 100 : 0
  const opsPerSec = mean > 0 ? 1000 / mean : 0

  return {
    opsPerSec: Math.round(opsPerSec),
    iterations: totalIterations,
    totalMs: measuredMs,
    latency: {
      mean,
      sd,
      sem,
      variance,
      moe,
      rme,
      p50: percentile(latencies, 0.5),
      p75: percentile(latencies, 0.75),
      p99: percentile(latencies, 0.99),
      min: n > 0 ? latencies[0] : 0,
      max: n > 0 ? latencies[n - 1] : 0,
      samplesCount: n,
      df,
      critical,
    },
    methodology: {
      version: METHODOLOGY_VERSION,
      confidence: DEFAULT_CONFIDENCE,
      sampleUnit: 'slice',
      sliceMs,
      mean: 'totalMs/iterations',
    },
  }
}

export function benchmarkStatsSource() {
  return `
const __METHODOLOGY_VERSION = ${JSON.stringify(METHODOLOGY_VERSION)};
const __DEFAULT_CONFIDENCE = ${DEFAULT_CONFIDENCE};
const __T_TABLE_95 = ${JSON.stringify(T_TABLE_95)};

function __tValue95(df) {
  if (df <= 0) return 1.96;
  if (__T_TABLE_95[df]) return __T_TABLE_95[df];
  if (df > 120) return 1.96;
  const keys = Object.keys(__T_TABLE_95).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i];
    const hi = keys[i + 1];
    if (lo <= df && hi >= df) {
      const frac = (df - lo) / (hi - lo);
      return __T_TABLE_95[lo] + frac * (__T_TABLE_95[hi] - __T_TABLE_95[lo]);
    }
  }
  return 1.96;
}

function __percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeBenchmarkStats(samples, opts = {}) {
  const clean = Array.isArray(samples)
    ? samples.filter(s => s && s.iters > 0 && s.ms > 0)
    : [];
  const latencies = clean.map(s => s.ms / s.iters).sort((a, b) => a - b);
  const n = latencies.length;
  const totalIterations = opts.iterations || clean.reduce((sum, s) => sum + s.iters, 0);
  const measuredMs = opts.totalMs || clean.reduce((sum, s) => sum + s.ms, 0);
  const mean = totalIterations > 0 && measuredMs > 0
    ? measuredMs / totalIterations
    : n > 0
      ? latencies.reduce((sum, value) => sum + value, 0) / n
      : 0;
  let variance = 0;
  if (n > 1) {
    const sumSquares = latencies.reduce((sum, value) => sum + ((value - mean) ** 2), 0);
    variance = sumSquares / (n - 1);
  }
  const sd = Math.sqrt(variance);
  const sem = n > 1 ? sd / Math.sqrt(n) : 0;
  const df = Math.max(n - 1, 1);
  const critical = __tValue95(df);
  const moe = sem * critical;
  const rme = mean > 0 ? (moe / mean) * 100 : 0;
  const opsPerSec = mean > 0 ? 1000 / mean : 0;
  return {
    opsPerSec: Math.round(opsPerSec),
    iterations: totalIterations,
    totalMs: measuredMs,
    latency: {
      mean,
      sd,
      sem,
      variance,
      moe,
      rme,
      p50: __percentile(latencies, 0.5),
      p75: __percentile(latencies, 0.75),
      p99: __percentile(latencies, 0.99),
      min: n > 0 ? latencies[0] : 0,
      max: n > 0 ? latencies[n - 1] : 0,
      samplesCount: n,
      df,
      critical,
    },
    methodology: {
      version: __METHODOLOGY_VERSION,
      confidence: __DEFAULT_CONFIDENCE,
      sampleUnit: 'slice',
      sliceMs: opts.sliceMs || 200,
      mean: 'totalMs/iterations',
    },
  };
}
`
}
