import { describe, expect, it, vi } from 'vitest'

// Mock both engines
vi.mock('../../lib/engines/quickjs', () => ({
  runInQuickJS: vi.fn(async (code, opts) => ({
    state: 'completed',
    opsPerSec: 1000 * (opts?.memoryLimit ? opts.memoryLimit / (16 * 1024 * 1024) : 1),
    latency: { mean: 1, p50: 0.9, p99: 1.5, min: 0.5, max: 2, samplesCount: 5 },
    memoryUsed: { totalBytes: 1024, objectCount: 10, stringCount: 5, functionCount: 2 },
  })),
}))

vi.mock('../../lib/engines/v8sandbox', () => ({
  runInV8Sandbox: vi.fn(async (code, opts) => ({
    state: 'completed',
    opsPerSec: 50000 * (opts?.vcpus || 1),
    latency: { mean: 0.02, p50: 0.018, p99: 0.03, min: 0.015, max: 0.04, samplesCount: 10 },
    heapUsed: 4194304,
    heapTotal: 8388608,
  })),
}))

import { runAnalysis } from '../../lib/engines/runner'

describe('runAnalysis', () => {
  it('runs both engines and combines results', async () => {
    const result = await runAnalysis([
      { code: 'var s = 0; for (var i = 0; i < 100; i++) s += i;', title: 'for loop' },
    ])

    expect(result.results).toHaveLength(1)
    expect(result.results[0].quickjs.opsPerSec).toBeGreaterThan(0)
    expect(result.results[0].v8.opsPerSec).toBeGreaterThan(0)
    expect(result.results[0].prediction).toBeDefined()
  })

  it('calculates JIT amplification ratio', async () => {
    const result = await runAnalysis([
      { code: 'x + 1', title: 'test' },
    ])

    expect(result.results[0].prediction.jitBenefit).toBeGreaterThan(1)
  })

  it('identifies fastest by algorithm vs fastest by runtime', async () => {
    const { runInQuickJS } = await import('../../lib/engines/quickjs')
    const { runInV8Sandbox } = await import('../../lib/engines/v8sandbox')

    let callCount = 0
    runInQuickJS.mockImplementation(async () => {
      callCount++
      // First test: higher QuickJS ops (algorithmically faster)
      const isFirstTest = callCount <= 3
      return {
        state: 'completed',
        opsPerSec: isFirstTest ? 500 : 1000,
        latency: { mean: 1, p50: 1, p99: 1, min: 1, max: 1, samplesCount: 1 },
        memoryUsed: { totalBytes: 1024, objectCount: 1, stringCount: 1, functionCount: 1 },
      }
    })

    let v8CallCount = 0
    runInV8Sandbox.mockImplementation(async () => {
      v8CallCount++
      // First test: higher V8 ops (runtime faster due to JIT)
      const isFirstTest = v8CallCount <= 3
      return {
        state: 'completed',
        opsPerSec: isFirstTest ? 100000 : 20000,
        latency: { mean: 0.01, p50: 0.01, p99: 0.01, min: 0.01, max: 0.01, samplesCount: 1 },
        heapUsed: 1024,
      }
    })

    const result = await runAnalysis([
      { code: 'test1()', title: 'JIT-friendly' },
      { code: 'test2()', title: 'Algorithmic' },
    ])

    expect(result.comparison).toBeDefined()
    expect(result.comparison.fastestByAlgorithm).toBe(1)
    expect(result.comparison.fastestByRuntime).toBe(0)
    expect(result.comparison.divergence).toBe(true)
  })

  it('returns results for each test index', async () => {
    const result = await runAnalysis([
      { code: 'a()', title: 'Test A' },
      { code: 'b()', title: 'Test B' },
    ])

    expect(result.results).toHaveLength(2)
    expect(result.results[0].testIndex).toBe(0)
    expect(result.results[1].testIndex).toBe(1)
    expect(result.results[0].title).toBe('Test A')
    expect(result.results[1].title).toBe('Test B')
  })

  it('handles partial failure (one engine errors)', async () => {
    const { runInV8Sandbox } = await import('../../lib/engines/v8sandbox')
    runInV8Sandbox.mockResolvedValueOnce({
      state: 'errored', error: 'Sandbox unavailable', opsPerSec: 0, latency: null, heapUsed: 0,
    })
    runInV8Sandbox.mockResolvedValueOnce({
      state: 'errored', error: 'Sandbox unavailable', opsPerSec: 0, latency: null, heapUsed: 0,
    })
    runInV8Sandbox.mockResolvedValueOnce({
      state: 'errored', error: 'Sandbox unavailable', opsPerSec: 0, latency: null, heapUsed: 0,
    })

    const result = await runAnalysis([
      { code: 'x + 1', title: 'test' },
    ])

    expect(result.results[0].quickjs.opsPerSec).toBeGreaterThan(0)
    expect(result.results[0].v8.opsPerSec).toBe(0)
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runAnalysis(
        [{ code: 'x + 1', title: 'test' }],
        { signal: controller.signal }
      )
    ).rejects.toThrow()
  })

  it('calls onProgress during execution', async () => {
    const progressCalls = []
    await runAnalysis(
      [{ code: 'x + 1', title: 'test' }],
      { onProgress: (step) => progressCalls.push(step) }
    )

    expect(progressCalls.length).toBeGreaterThan(0)
    expect(progressCalls.some(p => p.engine === 'quickjs')).toBe(true)
    expect(progressCalls.some(p => p.engine === 'v8')).toBe(true)
    expect(progressCalls.some(p => p.engine === 'prediction')).toBe(true)
  })

  it('throws for empty tests array', async () => {
    await expect(runAnalysis([])).rejects.toThrow('At least one test is required')
  })
})
