import { describe, expect, it } from 'vitest'
import { buildCompatibilityMatrix } from '../lib/compatibilityMatrix'

function cell(row: any, key: string) {
  return row.cells.find((entry: any) => entry.environmentKey === key)
}

describe('buildCompatibilityMatrix', () => {
  it('marks winners, losers, and irrelevant baselines across environments', () => {
    const matrix = buildCompatibilityMatrix({
      browserStats: {
        0: [
          { browserName: 'Chrome', avgOps: 20_000, count: 2 },
          { browserName: 'Firefox', avgOps: 10_000, count: 1 },
          { browserName: 'Safari', avgOps: 9_000, count: 1 },
        ],
        1: [
          { browserName: 'Chrome', avgOps: 10_000, count: 1 },
          { browserName: 'Firefox', avgOps: 15_000, count: 1 },
          { browserName: 'Safari', avgOps: 9_200, count: 1 },
        ],
      },
      results: [
        {
          testIndex: 0,
          title: 'JIT-friendly optimization',
          quickjs: { opsPerSec: 1_000, profiles: [{ state: 'completed', opsPerSec: 1_000 }] },
          v8: { opsPerSec: 50_000, profiles: [{ state: 'completed', opsPerSec: 50_000 }] },
          runtimeComparison: {
            runtimes: [
              { runtime: 'node', avgOpsPerSec: 10_000, profiles: [{ state: 'completed', opsPerSec: 10_000 }] },
              { runtime: 'deno', avgOpsPerSec: 9_000, profiles: [{ state: 'completed', opsPerSec: 9_000 }] },
              { runtime: 'bun', avgOpsPerSec: 3_000, profiles: [{ state: 'completed', opsPerSec: 3_000 }] },
            ],
          },
        },
        {
          testIndex: 1,
          title: 'JSC-friendly optimization',
          quickjs: { opsPerSec: 1_020, profiles: [{ state: 'completed', opsPerSec: 1_020 }] },
          v8: { opsPerSec: 30_000, profiles: [{ state: 'completed', opsPerSec: 30_000 }] },
          runtimeComparison: {
            runtimes: [
              { runtime: 'node', avgOpsPerSec: 5_000, profiles: [{ state: 'completed', opsPerSec: 5_000 }] },
              { runtime: 'deno', avgOpsPerSec: 9_500, profiles: [{ state: 'completed', opsPerSec: 9_500 }] },
              { runtime: 'bun', avgOpsPerSec: 12_000, profiles: [{ state: 'completed', opsPerSec: 12_000 }] },
            ],
          },
        },
      ],
    })

    const first = matrix.tests[0]
    expect(cell(first, 'chrome').comparison).toBe('wins')
    expect(cell(first, 'node').comparison).toBe('wins')
    expect(cell(first, 'bun').comparison).toBe('loses')
    expect(cell(first, 'quickjs').comparison).toBe('irrelevant')
    expect(first.insight).toContain('wins in')
    expect(first.insight).toContain('loses in')
    expect(first.insight).toContain('is irrelevant in')
  })

  it('normalizes and weights browser buckets', () => {
    const matrix = buildCompatibilityMatrix({
      browserStats: {
        0: [
          { browserName: 'Chrome', avgOps: 1_000, count: 1 },
          { browserName: 'Chrome WebView', avgOps: 2_000, count: 3 },
          { browserName: 'Mobile Safari', avgOps: 500, count: 2 },
        ],
      },
      results: [
        {
          testIndex: 0,
          title: 'Only test',
          quickjs: { opsPerSec: 10, profiles: [{ state: 'completed', opsPerSec: 10 }] },
          v8: { opsPerSec: 100, profiles: [{ state: 'completed', opsPerSec: 100 }] },
        },
      ],
    })

    const row = matrix.tests[0]
    expect(cell(row, 'chrome').opsPerSec).toBe(1_750)
    expect(cell(row, 'chrome').count).toBe(4)
    expect(cell(row, 'safari').opsPerSec).toBe(500)
    expect(cell(row, 'safari').count).toBe(2)
  })

  it('keeps runtime-specific failure reasons', () => {
    const matrix = buildCompatibilityMatrix({
      multiRuntimeStatus: 'done',
      results: [
        {
          testIndex: 0,
          title: 'Async snippet',
          quickjs: {
            opsPerSec: 0,
            profiles: [
              {
                state: 'unsupported',
                error: 'QuickJS-WASM deep analysis does not support async benchmark snippets yet.',
              },
            ],
          },
          v8: { opsPerSec: 1_000, profiles: [{ state: 'completed', opsPerSec: 1_000 }] },
          runtimeComparison: {
            runtimes: [
              { runtime: 'bun', hasError: true, error: 'ReferenceError: document is not defined', profiles: [] },
            ],
          },
        },
      ],
    })

    const row = matrix.tests[0]
    expect(cell(row, 'quickjs').state).toBe('unsupported')
    expect(cell(row, 'quickjs').reason).toContain('does not support async')
    expect(cell(row, 'bun').state).toBe('failed')
    expect(cell(row, 'bun').reason).toContain('document is not defined')
    expect(row.insight).toContain('runtime-specific failures')
  })
})
