// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
  },
}))

vi.mock('../../lib/engines/runtime-tags', () => ({
  fetchRuntimeTagSummary: vi.fn(async () => ({
    generatedAt: '2026-04-25T00:00:00.000Z',
    runtimes: {
      node: { latestStable: '24.11.1', previousStable: '24.11.0' },
    },
    options: [
      { target: 'node@lts', label: 'Node.js LTS', default: true },
      { target: 'node@24.11.1', label: 'Node.js 24.11.1', default: true },
    ],
    defaultTargets: ['node@lts', 'node@24.11.1'],
  })),
}))

import { redis } from '../../lib/redis'
import { fetchRuntimeTagSummary } from '../../lib/engines/runtime-tags'
import handler from '../../pages/api/benchmark/runtime-tags'

function createMockReq(method = 'GET') {
  return { method }
}

function createMockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    end: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    _status: null,
    _json: null,
  }
  res.status.mockImplementation((code) => {
    res._status = code
    return res
  })
  res.json.mockImplementation((data) => {
    res._json = data
    return res
  })
  return res
}

describe('GET /api/benchmark/runtime-tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 405 for non-GET methods', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST'), res)

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET'])
    expect(res._status).toBe(405)
  })

  it('fetches runtime tags and caches them', async () => {
    const res = createMockRes()
    await handler(createMockReq(), res)

    expect(res._status).toBe(200)
    expect(res._json.defaultTargets).toEqual(['node@lts', 'node@24.11.1'])
    expect(fetchRuntimeTagSummary).toHaveBeenCalledOnce()
    expect(redis.setex).toHaveBeenCalledWith(
      'runtime_tags_v1',
      3600,
      expect.stringContaining('node@24.11.1'),
    )
  })

  it('serves cached tag summaries', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({ defaultTargets: ['bun@1.3.0'] }))

    const res = createMockRes()
    await handler(createMockReq(), res)

    expect(res._status).toBe(200)
    expect(res._json.defaultTargets).toEqual(['bun@1.3.0'])
    expect(fetchRuntimeTagSummary).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('X-Runtime-Tags-Cache', 'HIT')
  })
})
