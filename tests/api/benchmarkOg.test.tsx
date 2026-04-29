// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findOneMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/mongodb', () => ({
  pagesCollection: vi.fn(async () => ({
    findOne: (...args) => findOneMock(...args),
  })),
}))

import handler from '../../pages/api/benchmark-og'

function createMockReq(query = {}, method = 'GET') {
  return { method, query }
}

function createMockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    send: vi.fn(() => res),
    end: vi.fn(() => res),
    _status: null,
    _json: null,
    _body: null,
  }
  res.status.mockImplementation((code) => { res._status = code; return res })
  res.json.mockImplementation((data) => { res._json = data; return res })
  res.send.mockImplementation((data) => { res._body = data; return res })
  return res
}

describe('GET /api/benchmark-og', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a cached PNG for a visible benchmark', async () => {
    findOneMock.mockResolvedValueOnce({
      title: 'Array map vs for loop',
      slug: 'array-map-vs-for-loop',
      revision: 2,
      published: '2026-04-29T12:00:00.000Z',
      language: 'javascript',
      visible: true,
      tests: [
        { title: 'map', code: 'items.map(fn)' },
        { title: 'for loop', code: 'for (const item of items) fn(item)' },
      ],
    })

    const res = createMockRes()
    await handler(createMockReq({ slug: 'array-map-vs-for-loop', revision: '2', v: 'abc123' }), res)

    expect(res._status).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, s-maxage=31536000, immutable',
    )
    expect(Buffer.isBuffer(res._body)).toBe(true)
    expect(res._body.length).toBeGreaterThan(1000)
  })

  it('returns 404 when the benchmark is missing', async () => {
    findOneMock.mockResolvedValueOnce(null)

    const res = createMockRes()
    await handler(createMockReq({ slug: 'missing', revision: '1' }), res)

    expect(res._status).toBe(404)
    expect(res._json).toEqual({ error: 'Benchmark not found' })
  })
})
