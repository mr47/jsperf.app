import { describe, expect, it } from 'vitest'
import {
  formatOps,
  formatMultiplier,
  speedColor,
  rankEntries,
  aggregateStats,
  aggregateRuntimeSources,
  summarizeShareItems,
  buildDeck,
  flattenRuntimes,
  collectPerfSamples,
  collectPredictionResults,
  collectMemoryResponseSeries,
  hasJitMetrics,
  hasMemoryResponse,
  hasInsightContent,
} from '../../components/report/slideUtils'

describe('slideUtils.formatOps', () => {
  it('formats large numbers with compact notation', () => {
    expect(formatOps(1500000)).toBe('1.5M')
    expect(formatOps(2400)).toBe('2.4K')
  })
  it('falls back to "—" for invalid input', () => {
    expect(formatOps(0)).toBe('—')
    expect(formatOps(-1)).toBe('—')
    expect(formatOps(NaN)).toBe('—')
  })
})

describe('slideUtils.formatMultiplier', () => {
  it('uses two decimals below 10×', () => {
    expect(formatMultiplier(2.345)).toBe('2.35×')
  })
  it('uses one decimal between 10× and 100×', () => {
    expect(formatMultiplier(42.7)).toBe('42.7×')
  })
  it('rounds large multipliers', () => {
    expect(formatMultiplier(987.4)).toBe('987×')
  })
})

describe('slideUtils.speedColor', () => {
  it('returns the leader color for rank 0', () => {
    expect(speedColor(0, 4)).toMatch(/^rgb\(/)
  })
  it('returns the laggard color for the last rank', () => {
    const first = speedColor(0, 5)
    const last = speedColor(4, 5)
    expect(first).not.toBe(last)
  })
  it('handles single-entry decks gracefully', () => {
    expect(speedColor(0, 1)).toBeTruthy()
  })
})

describe('slideUtils.rankEntries', () => {
  it('sorts by ops/sec descending and drops zeros', () => {
    const ranked = rankEntries([
      { title: 'a', opsPerSec: 100 },
      { title: 'b', opsPerSec: 0 },
      { title: 'c', opsPerSec: 500 },
    ])
    expect(ranked.map(e => e.title)).toEqual(['c', 'a'])
  })
})

describe('slideUtils.aggregateStats', () => {
  it('rolls per-test browser/OS shares up into totals', () => {
    const stats = {
      0: [
        { browserName: 'Chrome', osName: 'macOS', count: 10 },
        { browserName: 'Firefox', osName: 'Linux', count: 4 },
      ],
      1: [
        { browserName: 'Chrome', osName: 'Windows', count: 6 },
      ],
    }
    const out = aggregateStats(stats)
    expect(out.totalRuns).toBe(20)
    expect(out.browsers[0]).toMatchObject({ name: 'Chrome', count: 16 })
    expect(out.browsers[0].share).toBeCloseTo(0.8)
    expect(out.oses.find(o => o.name === 'Linux').share).toBeCloseTo(0.2)
  })
  it('returns empty arrays when there are no runs', () => {
    expect(aggregateStats(null)).toEqual({ totalRuns: 0, browsers: [], oses: [] })
  })
})

describe('slideUtils.summarizeShareItems', () => {
  it('keeps the list bounded and rolls overflow into Other', () => {
    const out = summarizeShareItems([
      { name: 'Chrome', count: 50, share: 0.5 },
      { name: 'Safari', count: 20, share: 0.2 },
      { name: 'Firefox', count: 15, share: 0.15 },
      { name: 'Edge', count: 10, share: 0.1 },
      { name: 'Opera', count: 5, share: 0.05 },
    ], 3)

    expect(out.map(item => item.name)).toEqual(['Chrome', 'Safari', 'Firefox', 'Other (2)'])
    expect(out[3]).toMatchObject({ count: 15 })
    expect(out[3].share).toBeCloseTo(0.15)
  })

  it('returns the original entries when already within the limit', () => {
    const items = [
      { name: 'Chrome', count: 3, share: 0.75 },
      { name: 'Firefox', count: 1, share: 0.25 },
    ]
    expect(summarizeShareItems(items, 3)).toEqual(items)
  })
})

describe('slideUtils.buildDeck', () => {
  it('always opens with title and ends with credits', () => {
    const deck = buildDeck({ summary: {} })
    expect(deck[0]).toBe('title')
    expect(deck[deck.length - 1]).toBe('credits')
  })
  it('skips analysis-dependent slides when no analysis is present', () => {
    const deck = buildDeck({
      summary: {
        ranked: [{ title: 'a', opsPerSec: 10 }, { title: 'b', opsPerSec: 5 }],
        leader: { title: 'a', opsPerSec: 10 },
        lagger: { title: 'b', opsPerSec: 5 },
      },
    })
    expect(deck).toContain('leaderboard')
    expect(deck).toContain('winner')
    expect(deck).not.toContain('insight')
    expect(deck).not.toContain('runtimes')
  })
  it('includes runtimes + insight + perfCounters slides when data is rich', () => {
    const deck = buildDeck({
      summary: {
        ranked: [{ title: 'a', opsPerSec: 10 }, { title: 'b', opsPerSec: 5 }],
        leader: { title: 'a', opsPerSec: 10 },
        lagger: { title: 'b', opsPerSec: 5 },
      },
      analysis: {
        comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
        results: [
          {
            testIndex: 0,
            title: 'a',
            multiRuntime: {
              byRuntime: {
                node: { avgOpsPerSec: 100, profiles: [{ opsPerSec: 100, perfCounters: { cycles: 10 } }] },
              },
            },
          },
        ],
      },
      stats: { 0: [{ browserName: 'Chrome', osName: 'macOS', count: 5 }] },
    })
    expect(deck).toContain('runtimes')
    expect(deck).toContain('perfCounters')
    expect(deck).toContain('insight')
    expect(deck).toContain('methodology')
  })

  it('includes prediction metric slides when JIT and memory-response data is present', () => {
    const report = {
      summary: {},
      analysis: {
        results: [
          {
            testIndex: 0,
            title: 'alloc light',
            quickjs: {
              profiles: [
                { label: '0.5x', memoryMB: 8, opsPerSec: 100 },
                { label: '1x', memoryMB: 16, opsPerSec: 200 },
              ],
            },
            prediction: {
              jitBenefit: 12.4,
              scalingType: 'linear',
              scalingConfidence: 0.95,
              characteristics: { jitFriendly: true, cpuBound: true },
            },
          },
        ],
      },
    }
    const deck = buildDeck(report)
    expect(deck).toContain('jitAmplification')
    expect(deck).toContain('memoryResponse')
  })

  it('includes methodology when only controlled runtime data is present', () => {
    const deck = buildDeck({
      summary: {},
      analysis: {
        results: [{
          testIndex: 0,
          title: 'runtime-only',
          multiRuntime: {
            byRuntime: {
              node: { avgOpsPerSec: 100, profiles: [{ opsPerSec: 100 }] },
              deno: { avgOpsPerSec: 90, profiles: [{ opsPerSec: 90 }] },
            },
          },
        }],
      },
    })
    expect(deck).toContain('methodology')
  })

  it('skips head-to-head when leader and lagger are the same test', () => {
    const same = { title: 'a', opsPerSec: 10 }
    const deck = buildDeck({
      summary: {
        ranked: [same, same],
        leader: same,
        lagger: same,
      },
    })
    expect(deck).not.toContain('headToHead')
  })
})

describe('slideUtils.aggregateRuntimeSources', () => {
  it('summarises runtime worker measurements by engine', () => {
    const summary = aggregateRuntimeSources({
      analysis: {
        results: [
          {
            testIndex: 0,
            title: 'fast',
            multiRuntime: {
              byRuntime: {
                node: {
                  avgOpsPerSec: 1000,
                  profiles: [{ opsPerSec: 1000, perfCounters: { cycles: 10 } }],
                },
                bun: {
                  avgOpsPerSec: 1500,
                  profiles: [{ opsPerSec: 1500 }],
                },
              },
            },
          },
          {
            testIndex: 1,
            title: 'slow',
            multiRuntime: {
              byRuntime: {
                node: {
                  avgOpsPerSec: 500,
                  profiles: [{ opsPerSec: 500 }],
                },
              },
            },
          },
        ],
      },
    })

    expect(summary.totalRuntimeSlots).toBe(3)
    expect(summary.totalProfiles).toBe(3)
    expect(summary.runtimes.find(r => r.runtime === 'node')).toMatchObject({
      tests: 2,
      profiles: 2,
      avgOpsPerSec: 750,
      hasPerfCounters: true,
    })
    expect(summary.runtimes.find(r => r.runtime === 'bun')).toMatchObject({
      tests: 1,
      profiles: 1,
      avgOpsPerSec: 1500,
    })
  })
})

describe('slideUtils.flattenRuntimes', () => {
  it('flattens object-shaped multi-runtime data into per-test-per-runtime slots', () => {
    const slots = flattenRuntimes({
      analysis: {
        results: [
          {
            testIndex: 0,
            title: 'fast',
            multiRuntime: {
              byRuntime: {
                node: { avgOpsPerSec: 1000, profiles: [] },
                bun: { avgOpsPerSec: 1500, profiles: [] },
              },
            },
          },
          {
            testIndex: 1,
            title: 'slow',
            multiRuntime: {
              byRuntime: {
                node: { avgOpsPerSec: 100, profiles: [], hasError: false },
                deno: { avgOpsPerSec: 0, profiles: [], hasError: true },
              },
            },
          },
        ],
      },
    })
    expect(slots).toHaveLength(3) // deno errored, dropped
    expect(slots.find(s => s.testTitle === 'fast' && s.runtime === 'bun').avgOpsPerSec).toBe(1500)
  })

  it('returns empty when no multi-runtime data is present', () => {
    expect(flattenRuntimes({ analysis: { results: [{ testIndex: 0 }] } })).toEqual([])
    expect(flattenRuntimes(null)).toEqual([])
  })
})

describe('slideUtils.collectPerfSamples', () => {
  it('only returns profiles that captured non-empty perf counters', () => {
    const samples = collectPerfSamples({
      analysis: {
        results: [{
          testIndex: 0,
          title: 't',
          multiRuntime: {
            byRuntime: {
              node: { profiles: [
                { opsPerSec: 1, perfCounters: {} },     // empty -> excluded
                { opsPerSec: 1, perfCounters: { cycles: 99 } },
              ] },
            },
          },
        }],
      },
    })
    expect(samples).toHaveLength(1)
    expect(samples[0].counters.cycles).toBe(99)
  })
})

describe('slideUtils prediction helpers', () => {
  it('collects prediction results and detects JIT metrics', () => {
    const report = {
      analysis: {
        results: [
          { testIndex: 0, title: 'a', prediction: { jitBenefit: 2.5 } },
          { testIndex: 1, title: 'b', prediction: null },
        ],
      },
    }
    expect(collectPredictionResults(report).map(r => r.title)).toEqual(['a'])
    expect(hasJitMetrics(report)).toBe(true)
  })

  it('builds a memory response series from multi-point profiles', () => {
    const report = {
      analysis: {
        results: [
          {
            testIndex: 0,
            title: 'a',
            quickjs: {
              profiles: [
                { label: '1x', memoryMB: 16, opsPerSec: 1000 },
                { label: '2x', memoryMB: 32, opsPerSec: 2000 },
              ],
            },
          },
          {
            testIndex: 1,
            title: 'b',
            quickjs: {
              profiles: [
                { label: '1x', memoryMB: 16, opsPerSec: 500 },
                { label: '2x', memoryMB: 32, opsPerSec: 750 },
              ],
            },
          },
        ],
      },
    }
    const series = collectMemoryResponseSeries(report)
    expect(hasMemoryResponse(report)).toBe(true)
    expect(series.source).toBe('quickjs')
    expect(series.data[0]).toMatchObject({ resource: '16 MB', test0: 1000, test1: 500 })
    expect(series.series.map(s => s.title)).toEqual(['a', 'b'])
  })
})

describe('slideUtils.hasInsightContent', () => {
  it('treats structured comparison with a fastest index as content', () => {
    expect(hasInsightContent({ fastestByAlgorithm: 0, fastestByRuntime: 1, divergence: true })).toBe(true)
  })
  it('treats prose comparison as content', () => {
    expect(hasInsightContent('A wins because of inlining')).toBe(true)
  })
  it('rejects empty/-1 comparison shapes', () => {
    expect(hasInsightContent({ fastestByAlgorithm: -1, fastestByRuntime: -1 })).toBe(false)
    expect(hasInsightContent('')).toBe(false)
    expect(hasInsightContent(null)).toBe(false)
  })
})
