// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { getRanked, formatNumber, formatLatency } from '../../utils/ArrayUtils'

describe('formatNumber', () => {
  it('formats integers with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(0)).toBe('0')
  })

  it('formats decimals with commas in integer part', () => {
    expect(formatNumber('1234567.89')).toBe('1,234,567.89')
    expect(formatNumber('999.12')).toBe('999.12')
  })
})

describe('formatLatency', () => {
  it('formats nanoseconds', () => {
    expect(formatLatency(0.0005)).toBe('500ns')
    expect(formatLatency(0.0001)).toBe('100ns')
  })

  it('formats microseconds', () => {
    expect(formatLatency(0.05)).toBe('50.0µs')
    expect(formatLatency(0.5)).toBe('500.0µs')
  })

  it('formats milliseconds', () => {
    expect(formatLatency(1.5)).toBe('1.5ms')
    expect(formatLatency(500)).toBe('500.0ms')
  })

  it('formats seconds', () => {
    expect(formatLatency(1500)).toBe('1.50s')
  })

  it('handles edge cases', () => {
    expect(formatLatency(0)).toBe('—')
    expect(formatLatency(-1)).toBe('—')
    expect(formatLatency(Infinity)).toBe('—')
    expect(formatLatency(NaN)).toBe('—')
  })
})

describe('getRanked', () => {
  function makeEntry(index, throughputMean, latencyMean, latencyMoe, state = 'completed') {
    return {
      index,
      name: `task_${index}`,
      result: {
        state,
        throughput: { mean: throughputMean },
        latency: { mean: latencyMean, moe: latencyMoe },
      },
    }
  }

  it('ranks by latency (lower latency = faster)', () => {
    const entries = [
      makeEntry(0, 100, 10, 1),
      makeEntry(1, 200, 5, 0.5),
      makeEntry(2, 150, 7, 0.7),
    ]

    const ranked = getRanked(entries)
    expect(ranked.map((r) => r.index)).toEqual([1, 2, 0])
  })

  it('filters out errored tasks', () => {
    const entries = [
      makeEntry(0, 100, 10, 1),
      makeEntry(1, 0, 0, 0, 'errored'),
    ]

    const ranked = getRanked(entries)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].index).toBe(0)
  })

  it('handles Infinity throughput', () => {
    const entries = [
      makeEntry(0, Infinity, 0, 0),
      makeEntry(1, 100, 10, 1),
    ]

    const ranked = getRanked(entries)
    expect(ranked[0].hz).toBe(Infinity)
    expect(ranked[1].index).toBe(1)
  })

  it('returns empty for no valid results', () => {
    const ranked = getRanked([])
    expect(ranked).toEqual([])
  })
})
