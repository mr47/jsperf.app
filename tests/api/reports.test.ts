// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from 'vitest'

const fakePages = new Map()
const fakeReports = new Map()
const insertedReports = []
const storedRuntimeDocs = []

vi.mock('../../lib/mongodb', () => ({
  pagesCollection: vi.fn(async () => ({
    findOne: vi.fn(async ({ slug, revision }) => {
      const key = `${slug}:${revision}`
      return fakePages.get(key) || null
    }),
  })),
  runsCollection: vi.fn(async () => ({
    aggregate: vi.fn(() => ({
      toArray: vi.fn(async () => [
        {
          _id: 0,
          stats: [
            { browserName: 'Chrome', osName: 'macOS', cpuArch: 'arm64', avgOps: 50000, count: 12 },
            { browserName: 'Firefox', osName: 'Linux', cpuArch: 'x64', avgOps: 30000, count: 8 },
          ],
        },
        {
          _id: 1,
          stats: [
            { browserName: 'Chrome', osName: 'macOS', cpuArch: 'arm64', avgOps: 10000, count: 9 },
          ],
        },
      ]),
    })),
  })),
  analysesCollection: vi.fn(async () => ({
    findOne: vi.fn(async () => ({
      results: [
        {
          testIndex: 0,
          title: 'Fast loop',
          v8: { opsPerSec: 80000, profiles: [{ opsPerSec: 80000, samples: 50, state: 'completed' }] },
          quickjs: { opsPerSec: 1000, profiles: [{ opsPerSec: 1000, samples: 50, state: 'completed' }] },
          complexity: { time: { notation: 'O(n)' }, space: { notation: 'O(1)' }, async: { mode: 'none' } },
        },
        {
          testIndex: 1,
          title: 'Slow loop',
          v8: { opsPerSec: 12000, profiles: [{ opsPerSec: 12000, samples: 50, state: 'completed' }] },
          quickjs: { opsPerSec: 800, profiles: [{ opsPerSec: 800, samples: 50, state: 'completed' }] },
        },
      ],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
    })),
  })),
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: vi.fn((query) => ({
      toArray: vi.fn(async () => storedRuntimeDocs.filter(doc =>
        doc.multiRuntimeCacheKey === query.multiRuntimeCacheKey &&
        query.testIndex?.$in?.includes(doc.testIndex)
      )),
    })),
  })),
  reportsCollection: vi.fn(async () => ({
    findOne: vi.fn(async (q) => {
      if (q?.id) return fakeReports.get(q.id) || null
      return null
    }),
    countDocuments: vi.fn(async () => 0),
    insertOne: vi.fn(async (doc) => {
      fakeReports.set(doc.id, doc)
      insertedReports.push(doc)
      return { insertedId: 'oid' }
    }),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    find: vi.fn(() => ({
      sort: () => ({ limit: () => ({ toArray: vi.fn(async () => []) }) }),
    })),
  })),
}))

import { createReport, getReportById } from '../../lib/reports'

describe('createReport', () => {
  beforeEach(() => {
    fakePages.clear()
    fakeReports.clear()
    insertedReports.length = 0
    storedRuntimeDocs.length = 0
    fakePages.set('demo:1', {
      slug: 'demo',
      revision: 1,
      title: 'Demo benchmark',
      authorName: 'tester',
      visible: true,
      tests: [
        { title: 'Fast loop', code: 'for (let i=0;i<100;i++);', async: false },
        { title: 'Slow loop', code: 'for (let i=0;i<1e6;i++);', async: false },
      ],
    })
  })

  it('snapshots the benchmark, stats, and analysis into a new report', async () => {
    const out = await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle', source: 'donate' },
    })
    expect(out.id).toMatch(/^[a-z2-9]{8}$/)
    expect(out.url).toBe(`/r/${out.id}`)
    const stored = insertedReports[0]
    expect(stored.title).toBe('Demo benchmark')
    expect(stored.creator).toMatchObject({ name: 'kyle', source: 'donate', boosted: true })
    expect(stored.benchmark.tests).toHaveLength(2)
    expect(stored.compatibilityMatrix.generatedByBoostedDonor).toBe(true)
    expect(stored.compatibilityMatrix.tests).toHaveLength(2)
    expect(stored.summary.leader.title).toBe('Fast loop')
    expect(stored.summary.lagger.title).toBe('Slow loop')
    expect(stored.summary.dataSource).toBe('v8')
    expect(stored.analysis.comparison).toMatchObject({ fastestByAlgorithm: 0, fastestByRuntime: 0 })
    expect(stored.analysis.results[0].complexity.time.notation).toBe('O(n)')
  })

  it('snapshots client-supplied multi-runtime data into the persisted analysis', async () => {
    const clientAnalysis = {
      results: [
        {
          testIndex: 0,
          title: 'Fast loop',
          v8: { opsPerSec: 80000, profiles: [{ opsPerSec: 80000 }] },
          quickjs: { opsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] },
        },
        {
          testIndex: 1,
          title: 'Slow loop',
          v8: { opsPerSec: 12000, profiles: [{ opsPerSec: 12000 }] },
          quickjs: { opsPerSec: 800, profiles: [{ opsPerSec: 800 }] },
        },
      ],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
    }
    const clientMultiRuntime = {
      results: [
        {
          testIndex: 0,
          state: 'done',
          runtimes: {
            node: {
              avgOpsPerSec: 90000,
              profiles: [{ opsPerSec: 90000, perfCounters: { cycles: 1000, instructions: 2000 } }],
            },
            bun: { avgOpsPerSec: 110000, profiles: [{ opsPerSec: 110000 }] },
          },
          runtimeComparison: { fastestRuntime: 'bun', slowestRuntime: 'node', spread: 1.22, available: true },
        },
      ],
    }
    await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle' },
      clientAnalysis,
      clientMultiRuntime,
    })
    const stored = insertedReports[insertedReports.length - 1]
    const test0 = stored.analysis.results.find(r => r.testIndex === 0)
    expect(test0.multiRuntime.byRuntime.node.avgOpsPerSec).toBe(90000)
    expect(test0.multiRuntime.byRuntime.bun.avgOpsPerSec).toBe(110000)
    expect(test0.multiRuntime.byRuntime.node.profiles[0].perfCounters.cycles).toBe(1000)
    expect(test0.runtimeComparison.fastestRuntime).toBe('bun')
  })

  it('snapshots stored multi-runtime data when client polling data is absent', async () => {
    const clientAnalysis = {
      codeHash: 'base123',
      multiRuntimeCacheKey: 'mr456',
      results: [
        {
          testIndex: 0,
          title: 'Fast loop',
          v8: { opsPerSec: 80000, profiles: [{ opsPerSec: 80000 }] },
          quickjs: { opsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] },
        },
      ],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
    }
    storedRuntimeDocs.push({
      multiRuntimeCacheKey: 'mr456',
      testIndex: 0,
      runtimes: {
        node: { avgOpsPerSec: 90000, profiles: [{ opsPerSec: 90000 }] },
        deno: { avgOpsPerSec: 85000, profiles: [{ opsPerSec: 85000 }] },
      },
      runtimeComparison: { fastestRuntime: 'node', slowestRuntime: 'deno', spread: 1.06, available: true },
    })

    await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle' },
      clientAnalysis,
    })

    const stored = insertedReports[insertedReports.length - 1]
    const test0 = stored.analysis.results.find(r => r.testIndex === 0)
    expect(test0.multiRuntime.byRuntime.node.avgOpsPerSec).toBe(90000)
    expect(test0.multiRuntime.byRuntime.deno.avgOpsPerSec).toBe(85000)
    expect(test0.runtimeComparison.fastestRuntime).toBe('node')
  })

  it('uses canonical deep-analysis ops/sec for report summary instead of first profile', async () => {
    const clientAnalysis = {
      results: [
        {
          testIndex: 0,
          title: 'Fast loop',
          v8: {
            opsPerSec: 5000,
            profiles: [
              { opsPerSec: 100000 },
              { opsPerSec: 5000 },
            ],
          },
          quickjs: { opsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] },
        },
        {
          testIndex: 1,
          title: 'Slow loop',
          v8: { opsPerSec: 8000, profiles: [{ opsPerSec: 8000 }] },
          quickjs: { opsPerSec: 800, profiles: [{ opsPerSec: 800 }] },
        },
      ],
    }

    await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle' },
      clientAnalysis,
    })

    const stored = insertedReports[insertedReports.length - 1]
    expect(stored.summary.leader.title).toBe('Slow loop')
    expect(stored.summary.entries.find(e => e.testIndex === 0).opsPerSec).toBe(5000)
  })

  it('normalises raw perf-event keys (kebab-case) into camelCase counters', async () => {
    const clientAnalysis = {
      results: [
        {
          testIndex: 0,
          title: 'Fast loop',
          v8: { opsPerSec: 80000, profiles: [{ opsPerSec: 80000 }] },
          quickjs: { opsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] },
        },
      ],
    }
    const clientMultiRuntime = {
      results: [
        {
          testIndex: 0,
          state: 'done',
          runtimes: {
            node: {
              avgOpsPerSec: 90000,
              profiles: [{
                opsPerSec: 90000,
                // These are the literal `perf stat` event names the
                // worker emits — the snapshotter has to translate them
                // or the radar chart in the report viewer ends up with
                // empty axes.
                perfCounters: {
                  cycles: 5_000_000,
                  instructions: 12_000_000,
                  'branch-misses': 4_200,
                  'cache-misses': 8_100,
                  'page-faults': 12,
                  'context-switches': 3,
                },
              }],
            },
          },
        },
      ],
    }
    await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle' },
      clientAnalysis,
      clientMultiRuntime,
    })
    const stored = insertedReports[insertedReports.length - 1]
    const counters = stored.analysis.results[0].multiRuntime.byRuntime.node.profiles[0].perfCounters
    expect(counters).toMatchObject({
      cycles: 5_000_000,
      instructions: 12_000_000,
      branchMisses: 4_200,
      cacheMisses: 8_100,
      pageFaults: 12,
      contextSwitches: 3,
    })
    // Ensure the kebab-case keys aren't carried through alongside the
    // camelCase ones (would double the perf payload size for nothing).
    expect(counters['branch-misses']).toBeUndefined()
    expect(counters['cache-misses']).toBeUndefined()
  })

  it('rejects when no donor is supplied', async () => {
    await expect(
      createReport({ slug: 'demo', revision: 1, donor: null })
    ).rejects.toThrow(/donor is required/)
  })

  it('returns NOT_FOUND when source benchmark is missing', async () => {
    await expect(
      createReport({ slug: 'missing', revision: 1, donor: { name: 'kyle' } })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('round-trips through getReportById', async () => {
    const { id } = await createReport({
      slug: 'demo',
      revision: 1,
      donor: { name: 'kyle' },
    })
    const found = await getReportById(id)
    expect(found.id).toBe(id)
    expect(found.summary.leader.title).toBe('Fast loop')
  })
})
