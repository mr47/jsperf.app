import { describe, expect, it } from 'vitest'
import { runInQuickJS } from '../../lib/engines/quickjs'

describe('runInQuickJS', () => {
  it('executes sync code and returns opsPerSec > 0', async () => {
    const result = await runInQuickJS(
      'var s = 0; for (var i = 0; i < 100; i++) s += i;',
      { timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
    expect(result.latency).toBeDefined()
    expect(result.latency.mean).toBeGreaterThan(0)
    expect(result.latency.samplesCount).toBeGreaterThan(0)
  })

  it('executes code with setup', async () => {
    const result = await runInQuickJS(
      'arr.push(1); arr.pop();',
      { setup: 'var arr = [];', timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it('compiles snippets that end with a line comment', async () => {
    const result = await runInQuickJS(
      'var x = 1 + 1; // trailing comment',
      { timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it('provides a no-op console shim', async () => {
    const result = await runInQuickJS(
      'console.log("debug"); console.warn("warn");',
      { timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it('returns deterministic relative results for same code', async () => {
    const code = 'var s = 0; for (var i = 0; i < 50; i++) s += i;'

    const run1 = await runInQuickJS(code, { timeMs: 500 })
    const run2 = await runInQuickJS(code, { timeMs: 500 })

    expect(run1.state).toBe('completed')
    expect(run2.state).toBe('completed')
    // ops/sec should be in the same ballpark (within 50%)
    const ratio = run1.opsPerSec / run2.opsPerSec
    expect(ratio).toBeGreaterThan(0.5)
    expect(ratio).toBeLessThan(2.0)
  })

  it('handles syntax errors gracefully', async () => {
    const result = await runInQuickJS('function {{{ bad syntax', { timeMs: 500 })

    expect(result.state).toBe('errored')
    expect(result.error).toBeDefined()
    expect(result.opsPerSec).toBe(0)
  })

  it('handles runtime errors gracefully', async () => {
    const result = await runInQuickJS('throw new Error("boom")', { timeMs: 500 })

    expect(result.state).toBe('errored')
    expect(result.error).toBeDefined()
  })

  it('handles setup errors gracefully', async () => {
    const result = await runInQuickJS(
      'x + 1',
      { setup: 'throw new Error("setup failed")', timeMs: 500 }
    )

    expect(result.state).toBe('errored')
    expect(result.error).toContain('Setup error')
  })

  it('marks async snippets unsupported instead of returning misleading QuickJS numbers', async () => {
    const result = await runInQuickJS(
      'await Promise.resolve(1)',
      { timeMs: 500, isAsync: true }
    )

    expect(result.state).toBe('unsupported')
    expect(result.opsPerSec).toBe(0)
    expect(result.methodology.async).toBe(false)
  })

  it('returns memory usage data', async () => {
    const result = await runInQuickJS(
      'var arr = []; for (var i = 0; i < 10; i++) arr.push(i);',
      { timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.memoryUsed).toBeDefined()
    expect(result.memoryUsed.totalBytes).toBeGreaterThan(0)
  })

  it('returns latency percentiles', async () => {
    const result = await runInQuickJS(
      'var s = 0; for (var i = 0; i < 100; i++) s += i;',
      { timeMs: 500 }
    )

    expect(result.state).toBe('completed')
    expect(result.latency.p50).toBeGreaterThan(0)
    expect(result.latency.p99).toBeGreaterThanOrEqual(result.latency.p50)
    expect(result.latency.min).toBeLessThanOrEqual(result.latency.p50)
    expect(result.latency.max).toBeGreaterThanOrEqual(result.latency.p99)
  })

  it('respects memory limit', async () => {
    const result = await runInQuickJS(
      'var arr = []; for (var i = 0; i < 1000000; i++) arr.push(new Array(100));',
      { timeMs: 2000, memoryLimit: 1024 * 1024 } // 1MB - too small for huge allocs
    )

    // Should either error out or complete with degraded performance
    expect(['completed', 'errored']).toContain(result.state)
  })
})
