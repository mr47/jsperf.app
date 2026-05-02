// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getJobMock = vi.hoisted(() => vi.fn())
const buildRuntimeComparisonMock = vi.hoisted(() => vi.fn())
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())
const updateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))
const cpuProfileUpdateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))

vi.mock('../../lib/engines/multiruntime', () => ({
  getMultiRuntimeJob: (...args) => getJobMock(...args),
}))

vi.mock('../../lib/prediction/model', () => ({
  buildRuntimeComparison: (...args) => buildRuntimeComparisonMock(...args),
}))

vi.mock('../../lib/mongodb', () => ({
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args) => multiRuntimeFindMock(...args),
    updateOne: (...args) => updateOneMock(...args),
  })),
  cpuProfilesCollection: vi.fn(async () => ({
    updateOne: (...args) => cpuProfileUpdateOneMock(...args),
  })),
}))

import handler from '../../pages/api/benchmark/multi-runtime/[jobId]'

function createMockReq(query, method = 'GET') {
  return { method, query }
}

function createMockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    end: vi.fn(() => res),
    _status: null,
    _json: null,
  }
  res.status.mockImplementation((code) => { res._status = code; return res })
  res.json.mockImplementation((data) => { res._json = data; return res })
  return res
}

describe('GET /api/benchmark/multi-runtime/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
  })

  it('serves completed multi-runtime results from durable storage', async () => {
    multiRuntimeFindMock.mockReturnValueOnce({ toArray: vi.fn(async () => [{
      testIndex: 0,
      runtimes: { node: { avgOpsPerSec: 1000 } },
      runtimeComparison: { available: true, fastestRuntime: 'node' },
    }]) })

    const res = createMockRes()
    await handler(createMockReq({ jobId: 'job-1', testIndex: '0', codeHash: 'mr-key' }), res)

    expect(res._status).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('X-MR-Store', 'HIT')
    expect(res._json).toMatchObject({
      state: 'done',
      runtimes: { node: { avgOpsPerSec: 1000 } },
      runtimeComparison: { available: true, fastestRuntime: 'node' },
    })
    expect(getJobMock).not.toHaveBeenCalled()
  })

  it('persists completed worker results to durable storage', async () => {
    const runtimes = { node: { avgOpsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] } }
    const runtimeComparison = { available: true, fastestRuntime: 'node', runtimes: [] }
    getJobMock.mockResolvedValueOnce({ state: 'done', result: { runtimes } })
    buildRuntimeComparisonMock.mockReturnValueOnce(runtimeComparison)

    const res = createMockRes()
    await handler(createMockReq({ jobId: 'job-1', testIndex: '0', codeHash: 'mr-key' }), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ state: 'done', runtimes, runtimeComparison })
    expect(updateOneMock).toHaveBeenCalledWith(
      { multiRuntimeCacheKey: 'mr-key', testIndex: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          multiRuntimeCacheKey: 'mr-key',
          testIndex: 0,
          runtimes,
          runtimeComparison,
        }),
        $setOnInsert: expect.objectContaining({
          createdAt: expect.any(Date),
        }),
      }),
      { upsert: true },
    )
  })

  it('stores raw CPU profiles separately and returns refs', async () => {
    const cpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2] },
        { id: 2, callFrame: { functionName: 'runBenchmark', url: 'bench.js' }, children: [3, 5] },
        { id: 3, callFrame: { functionName: 'jsperfUserBenchmark', url: 'jsperf-user-code.js' }, children: [4] },
        { id: 4, callFrame: { functionName: 'hot', url: 'jsperf-user-code.js' } },
        { id: 5, callFrame: { functionName: 'now', url: 'node:perf_hooks' } },
      ],
      samples: [4, 5],
      timeDeltas: [1000, 500],
      startTime: 1,
      endTime: 2,
    }
    const runtimes = {
      node: {
        runtime: 'node',
        avgOpsPerSec: 1000,
        profiles: [{ label: '1x', opsPerSec: 1000, cpuProfile }],
      },
    }
    buildRuntimeComparisonMock.mockImplementationOnce((shaped) => ({
      available: true,
      fastestRuntime: 'node',
      runtimes: [{ runtime: 'node', profiles: shaped.node.profiles }],
    }))
    getJobMock.mockResolvedValueOnce({ state: 'done', result: { runtimes } })

    const res = createMockRes()
    await handler(createMockReq({ jobId: 'job-1', testIndex: '0', codeHash: 'mr-key' }), res)

    expect(res._status).toBe(200)
    expect(cpuProfileUpdateOneMock).toHaveBeenCalledWith(
      { id: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({
          multiRuntimeCacheKey: 'mr-key',
          testIndex: 0,
          runtime: 'node',
          cpuProfile,
          focusedCpuProfile: expect.objectContaining({
            samples: [3],
            timeDeltas: [1000],
          }),
        }),
      }),
      { upsert: true },
    )
    expect(res._json.runtimes.node.profiles[0].cpuProfile).toBeUndefined()
    expect(res._json.runtimes.node.profiles[0].cpuProfileRef).toEqual(expect.objectContaining({
      id: expect.any(String),
      format: 'cpuprofile',
      runtime: 'node',
      sampleCount: 2,
      focusedSampleCount: 1,
    }))
    expect(updateOneMock).toHaveBeenCalledWith(
      { multiRuntimeCacheKey: 'mr-key', testIndex: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          runtimes: expect.objectContaining({
            node: expect.objectContaining({
              profiles: [expect.objectContaining({
                cpuProfileRef: expect.objectContaining({ runtime: 'node' }),
              })],
            }),
          }),
        }),
      }),
      { upsert: true },
    )
  })
})
