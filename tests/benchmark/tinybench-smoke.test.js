import { describe, expect, it } from 'vitest'
import { runBenchmark } from '../../utils/benchmark'

describe('runBenchmark', () => {
  it('benchmarks a sync function and produces statistics', async () => {
    const result = await runBenchmark(
      () => { let s = 0; for (let i = 0; i < 100; i++) s += i },
      { time: 300 }
    )

    expect(result.state).toBe('completed')
    expect(result.throughput.mean).toBeGreaterThan(0)
    expect(result.latency.samplesCount).toBeGreaterThan(0)
    expect(result.latency.mean).toBeGreaterThan(0)
    expect(result.latency.rme).toBeGreaterThanOrEqual(0)
    expect(result.latency.min).toBeLessThanOrEqual(result.latency.mean)
    expect(result.latency.max).toBeGreaterThanOrEqual(result.latency.mean)
  })

  it('benchmarks an async function', async () => {
    const result = await runBenchmark(
      async () => { await new Promise((r) => setTimeout(r, 1)) },
      { time: 300, isAsync: true }
    )

    expect(result.state).toBe('completed')
    expect(result.throughput.mean).toBeGreaterThan(0)
    expect(result.latency.samplesCount).toBeGreaterThan(0)
  })

  it('calls onProgress during multi-pass execution', async () => {
    const progressCalls = []
    await runBenchmark(
      () => { let s = 0; for (let i = 0; i < 100; i++) s += i },
      {
        time: 500,
        onProgress(elapsed, sampleCount, runs, currentHz) {
          progressCalls.push({ elapsed, sampleCount, runs, currentHz })
        },
      }
    )

    expect(progressCalls.length).toBeGreaterThan(0)
    const last = progressCalls[progressCalls.length - 1]
    expect(last.sampleCount).toBeGreaterThan(0)
    expect(last.runs).toBeGreaterThan(0)
    expect(last.elapsed).toBeGreaterThan(0)
    expect(last.currentHz).toBeGreaterThan(0)
  })

  it('respects abort signal (pre-aborted)', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runBenchmark(
      () => { let s = 0; for (let i = 0; i < 100; i++) s += i },
      { time: 5000, signal: controller.signal }
    )

    expect(result.state).toMatch(/aborted/)
  })

  it('handles errored functions', async () => {
    const result = await runBenchmark(
      () => { throw new Error('boom') },
      { time: 300 }
    )

    expect(result.state).toBe('errored')
    expect(result.error).toBeDefined()
  })

  it('produces correct percentile fields from tinybench', async () => {
    const result = await runBenchmark(
      () => { let s = 0; for (let i = 0; i < 100; i++) s += i },
      { time: 300 }
    )

    expect(result.latency.p50).toBeGreaterThan(0)
    expect(result.latency.p99).toBeGreaterThanOrEqual(result.latency.p50)
  })
})
