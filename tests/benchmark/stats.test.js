import { describe, expect, it } from 'vitest'
import { computeBenchmarkStats, METHODOLOGY_VERSION } from '../../lib/benchmark/stats.js'

describe('computeBenchmarkStats', () => {
  it('computes weighted throughput and uncertainty fields from slice samples', () => {
    const stats = computeBenchmarkStats([
      { iters: 100, ms: 10 },
      { iters: 200, ms: 20 },
      { iters: 100, ms: 20 },
    ], { iterations: 400, totalMs: 50, sliceMs: 200 })

    expect(stats.opsPerSec).toBe(8000)
    expect(stats.latency.mean).toBeCloseTo(0.125)
    expect(stats.latency.sem).toBeGreaterThan(0)
    expect(stats.latency.rme).toBeGreaterThan(0)
    expect(stats.latency.p95).toBeGreaterThan(0)
    expect(stats.latency.samplesCount).toBe(3)
    expect(stats.methodology.version).toBe(METHODOLOGY_VERSION)
    expect(stats.methodology.mean).toBe('totalMs/iterations')
  })

  it('handles empty sample arrays without throwing', () => {
    const stats = computeBenchmarkStats([])
    expect(stats.opsPerSec).toBe(0)
    expect(stats.latency.samplesCount).toBe(0)
    expect(stats.latency.mean).toBe(0)
  })
})
