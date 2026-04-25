// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getJobMock = vi.hoisted(() => vi.fn())
const buildRuntimeComparisonMock = vi.hoisted(() => vi.fn())
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())
const updateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))

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
})
