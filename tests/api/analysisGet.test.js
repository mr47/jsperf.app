import { describe, expect, it, vi, beforeEach } from 'vitest'

const findOneMock = vi.fn()
const multiRuntimeFindMock = vi.fn()

vi.mock('../../lib/mongodb', () => ({
  analysesCollection: vi.fn(async () => ({
    findOne: (...args) => findOneMock(...args),
  })),
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args) => multiRuntimeFindMock(...args),
  })),
}))

import handler from '../../pages/api/benchmark/analysis'

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

describe('GET /api/benchmark/analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
  })

  it('returns 405 for non-GET methods', async () => {
    const res = createMockRes()
    await handler(createMockReq({}, 'POST'), res)
    expect(res._status).toBe(405)
  })

  it('returns 400 when slug or revision is missing', async () => {
    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo' }), res)
    expect(res._status).toBe(400)
  })

  it('returns 400 for invalid revision', async () => {
    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo', revision: 'abc' }), res)
    expect(res._status).toBe(400)
  })

  it('returns 404 when no analysis is stored', async () => {
    findOneMock.mockResolvedValueOnce(null)

    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo', revision: '2' }), res)

    expect(findOneMock).toHaveBeenCalledWith(
      { slug: 'foo', revision: 2, hasErrors: { $ne: true } },
      { sort: { createdAt: -1 } },
    )
    expect(res._status).toBe(404)
  })

  it('returns the stored analysis when present', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z')
    findOneMock.mockResolvedValueOnce({
      slug: 'foo',
      revision: 2,
      codeHash: 'abc123',
      results: [{ testIndex: 0, title: 'test' }],
      comparison: { fastestByAlgorithm: 0 },
      hasErrors: false,
      createdAt,
    })

    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo', revision: '2' }), res)

    expect(res._status).toBe(200)
    expect(res._json.codeHash).toBe('abc123')
    expect(res._json.analysis.results).toHaveLength(1)
    expect(res._json.analysis.comparison.fastestByAlgorithm).toBe(0)
    expect(res._json.createdAt).toBe(createdAt)
  })

  it('returns 404 when codeHash differs from stored snapshot', async () => {
    findOneMock.mockResolvedValueOnce({
      slug: 'foo', revision: 2, codeHash: 'abc123',
      results: [], comparison: {}, hasErrors: false, createdAt: new Date(),
    })

    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo', revision: '2', codeHash: 'different' }), res)

    expect(res._status).toBe(404)
    expect(res._json.error).toMatch(/different code hash/)
  })

  it('opportunistically attaches multi-runtime data from durable storage', async () => {
    findOneMock.mockResolvedValueOnce({
      slug: 'foo', revision: 2, codeHash: 'abc123',
      multiRuntimeCacheKey: 'mr456',
      results: [{ testIndex: 0, title: 'test' }],
      comparison: {}, hasErrors: false, createdAt: new Date(),
    })
    multiRuntimeFindMock.mockReturnValueOnce({ toArray: vi.fn(async () => [{
      testIndex: 0,
      runtimes: { node: { avgOpsPerSec: 1000 } },
      runtimeComparison: { available: true },
    }]) })

    const res = createMockRes()
    await handler(createMockReq({ slug: 'foo', revision: '2' }), res)

    expect(multiRuntimeFindMock).toHaveBeenCalledWith({
      multiRuntimeCacheKey: 'mr456',
      testIndex: { $in: [0] },
    })
    expect(res._status).toBe(200)
    expect(res._json.multiRuntime?.results).toHaveLength(1)
    expect(res._json.multiRuntime.results[0].state).toBe('done')
    expect(res._json.multiRuntime.fromStore).toBe(true)
  })
})
