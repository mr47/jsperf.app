import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisStore = vi.hoisted(() => new Map())
const promoDocs = vi.hoisted(() => new Map())
const getTokenMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (key) => redisStore.get(key) || null),
    set: vi.fn(async (key, value) => {
      redisStore.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (key) => {
      const existed = redisStore.delete(key)
      return existed ? 1 : 0
    }),
  },
}))

vi.mock('../../lib/mongodb', () => ({
  promoCodesCollection: vi.fn(async () => ({
    updateOne: vi.fn(async (query, update, options) => {
      const key = `${query.type}:${query.code}`
      const existing = promoDocs.get(key)
      if (!existing && options?.upsert) {
        promoDocs.set(key, {
          ...query,
          ...update?.$setOnInsert,
          ...update?.$set,
        })
        return { upsertedCount: 1, matchedCount: 0 }
      }
      if (existing) {
        promoDocs.set(key, {
          ...existing,
          ...update?.$set,
        })
      }
      return { upsertedCount: 0, matchedCount: existing ? 1 : 0 }
    }),
    findOne: vi.fn(async (query) => {
      if (query.type === 'code') {
        const doc = promoDocs.get(`code:${query.code}`)
        if (query.active === true && !doc?.active) return null
        return doc || null
      }
      if (query.type === 'redemption') {
        return promoDocs.get(`redemption:${query.code}:${query.email}`) || null
      }
      return null
    }),
    insertOne: vi.fn(async (doc) => {
      const key = `${doc.type}:${doc.code}:${doc.email}`
      if (promoDocs.has(key)) {
        const error: any = new Error('duplicate key')
        error.code = 11000
        throw error
      }
      promoDocs.set(key, doc)
      return { insertedId: 'promo_id' }
    }),
  })),
}))

vi.mock('@upstash/ratelimit', () => {
  class RatelimitMock {
    constructor() {}
    async limit() { return { success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 } }
    static slidingWindow() { return {} }
  }
  return { Ratelimit: RatelimitMock }
})

vi.mock('next-auth/jwt', () => ({
  getToken: (...args) => getTokenMock(...args),
}))

import handler from '../../pages/api/donor/promo'

function createMockReq(body = {}, method = 'POST') {
  return {
    method,
    body,
    headers: { 'x-forwarded-for': '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function createMockRes() {
  const res: any = {
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

describe('POST /api/donor/promo', () => {
  beforeEach(() => {
    redisStore.clear()
    promoDocs.clear()
    vi.clearAllMocks()
    process.env.NEXTAUTH_SECRET = 'test-secret'
    getTokenMock.mockResolvedValue({
      user: {
        email: 'Tester@AgileEngine.com',
        name: 'Promo Tester',
      },
    })
  })

  it('returns 405 for non-POST methods', async () => {
    const req = createMockReq({}, 'GET')
    const res = createMockRes()

    await handler(req, res)

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST'])
    expect(res._status).toBe(405)
  })

  it('requires a signed-in GitHub user', async () => {
    getTokenMock.mockResolvedValue(null)
    const req = createMockReq({ code: 'AE' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
    expect(res._json.success).toBe(false)
  })

  it('rejects unknown promo codes', async () => {
    const req = createMockReq({ code: 'NOPE' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(404)
    expect(res._json.success).toBe(false)
  })

  it('requires an AgileEngine email for AE', async () => {
    getTokenMock.mockResolvedValue({
      user: {
        email: 'tester@example.com',
        name: 'Promo Tester',
      },
    })
    const req = createMockReq({ code: 'AE' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(403)
    expect(res._json.error).toContain('@agileengine.com')
  })

  it('redeems AE for a 30-day donor promo session', async () => {
    const req = createMockReq({ code: 'ae' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.ttl).toBe(60 * 60 * 24 * 30)
    expect(res._json.donor).toMatchObject({
      name: 'Promo Tester',
      source: 'promo',
      tierName: 'AE promo',
      email: 'tester@agileengine.com',
      via: 'promo',
      promoCode: 'AE',
    })
    expect(promoDocs.get('code:AE')).toMatchObject({
      type: 'code',
      code: 'AE',
      allowedEmailDomain: 'agileengine.com',
    })
    expect(promoDocs.get('redemption:AE:tester@agileengine.com')).toMatchObject({
      type: 'redemption',
      code: 'AE',
      email: 'tester@agileengine.com',
    })
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('jsperf_donor=')
    )
  })

  it('restores an active AE redemption for the same user', async () => {
    const firstReq = createMockReq({ code: 'AE' })
    const firstRes = createMockRes()
    await handler(firstReq, firstRes)

    const secondReq = createMockReq({ code: 'AE' })
    const secondRes = createMockRes()
    await handler(secondReq, secondRes)

    expect(secondRes._status).toBe(200)
    expect(secondRes._json.success).toBe(true)
    expect(secondRes._json.alreadyRedeemed).toBe(true)
    expect(secondRes._json.ttl).toBeGreaterThan(0)
    expect(secondRes._json.ttl).toBeLessThanOrEqual(60 * 60 * 24 * 30)
  })
})
