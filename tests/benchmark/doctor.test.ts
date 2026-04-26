import { describe, expect, it } from 'vitest'
import { buildBenchmarkDoctor } from '../../lib/benchmark/doctor'

function result(testIndex: number, title: string, opsPerSec: number, mean: number, moe: number, rme: number, samplesCount = 8) {
  return {
    testIndex,
    title,
    quickjs: { opsPerSec: 0, profiles: [] },
    v8: {
      opsPerSec,
      profiles: [{
        state: 'completed',
        opsPerSec,
        latency: { mean, moe, rme, samplesCount },
      }],
    },
  }
}

describe('buildBenchmarkDoctor', () => {
  it('returns structured source diagnostics with severity ordering', () => {
    const doctor = buildBenchmarkDoctor({
      tests: [
        { title: 'promise', code: 'return Promise.resolve(1)' },
        { title: 'literal', code: '2 + 2' },
        { title: 'browser', code: 'document.createElement("div")' },
      ],
      setup: 'const seed = 1',
      results: [],
    })

    expect(doctor.summary.total).toBeGreaterThanOrEqual(4)
    expect(doctor.summary.danger).toBe(1)
    expect(doctor.summary.verdict).toBe('misleading')
    expect(doctor.diagnostics[0]).toMatchObject({
      severity: 'danger',
      category: 'async-not-awaited',
      testTitle: 'promise',
    })
    expect(doctor.diagnostics.map(d => d.category)).toEqual(expect.arrayContaining([
      'dead-code-elimination',
      'constant-folding',
      'browser-api-server-runtime',
    ]))
  })

  it('flags high variance and low sample counts from latency stats', () => {
    const doctor = buildBenchmarkDoctor({
      tests: [{ title: 'noisy', code: 'return value' }],
      results: [result(0, 'noisy', 1000, 1, 0.4, 40, 3)],
    })

    expect(doctor.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'high-variance',
        severity: 'danger',
        testTitle: 'noisy',
      }),
      expect.objectContaining({
        category: 'high-variance',
        title: 'Low sample count',
      }),
    ]))
  })

  it('flags winners whose confidence intervals overlap', () => {
    const doctor = buildBenchmarkDoctor({
      tests: [
        { title: 'fast', code: 'return fast()' },
        { title: 'close', code: 'return close()' },
      ],
      results: [
        result(0, 'fast', 1100, 0.9, 0.12, 13),
        result(1, 'close', 1000, 1.0, 0.12, 12),
      ],
    })

    expect(doctor.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'winner-not-significant',
        scope: 'run',
        severity: 'warning',
      }),
    ]))
  })

  it('stays clean for observable stable benchmarks', () => {
    const doctor = buildBenchmarkDoctor({
      tests: [
        { title: 'fast', code: 'return values.includes(10)' },
        { title: 'slow', code: 'return values.includes(999)' },
      ],
      setup: 'const values = Array.from({ length: 1000 }, (_, i) => i)',
      results: [
        result(0, 'fast', 2000, 0.5, 0.01, 2, 10),
        result(1, 'slow', 1000, 1.0, 0.01, 1, 10),
      ],
    })

    expect(doctor.summary).toMatchObject({
      total: 0,
      verdict: 'clean',
    })
  })
})
