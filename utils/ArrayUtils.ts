// @ts-nocheck
/**
 * Format a number with comma separators (e.g. 1234567 → "1,234,567").
 */
export function formatNumber(num) {
  const parts = String(num).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

/**
 * Format a latency value (in milliseconds) to a human-readable string
 * with the most appropriate unit (ns / µs / ms / s).
 */
export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 0.001) return `${(ms * 1e6).toFixed(0)}ns`
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Rank an array of benchmark result entries from fastest to slowest.
 * Each entry: { result, index, name }
 * Returns entries augmented with `hz` (ops/sec from throughput.mean).
 */
export function getRanked(taskResults) {
  return taskResults
    .filter((entry) => {
      const r = entry.result
      return (
        r &&
        (r.state === 'completed' || r.state === 'aborted-with-statistics') &&
        (Number.isFinite(r.throughput.mean) || r.throughput.mean === Infinity)
      )
    })
    .map((entry) => ({
      ...entry,
      hz: entry.result.throughput.mean,
    }))
    .sort((a, b) => {
      if (a.hz === Infinity && b.hz !== Infinity) return -1
      if (b.hz === Infinity && a.hz !== Infinity) return 1
      if (a.hz === Infinity && b.hz === Infinity) return 0
      const aLat = a.result.latency.mean + a.result.latency.moe
      const bLat = b.result.latency.mean + b.result.latency.moe
      return aLat > bLat ? 1 : -1
    })
}
