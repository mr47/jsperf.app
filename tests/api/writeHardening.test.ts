import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCollection, FakeRedis } from '../helpers/fakeMongo'

const state = vi.hoisted(() => ({
  pages: null as any,
  runs: null as any,
  redis: null as any,
  limitImpl: null as null | ((id: string) => Promise<any>),
}))

vi.mock('../../lib/redis', () => ({ redis: new Proxy({}, { get: (_t, prop) => (state.redis as any)[prop] }) }))
vi.mock('../../lib/mongodb', () => ({
  pagesCollection: vi.fn(async () => state.pages),
  runsCollection: vi.fn(async () => state.runs),
  usersCollection: vi.fn(async () => new FakeCollection()),
  ipBansCollection: vi.fn(async () => new FakeCollection()),
  errorsCollection: vi.fn(async () => new FakeCollection()),
}))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
vi.mock('../../lib/donatello', () => ({ findDonorByEmail: vi.fn(async () => null) }))
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow() { return {} }
    async limit(id: string) {
      if (state.limitImpl) return state.limitImpl(id)
      return { success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000, pending: Promise.resolve() }
    }
  }
  return { Ratelimit }
})

import benchHandler from '../../pages/api/bench'
import runsHandler from '../../pages/api/runs'
import revalidateHandler, { isAllowedRevalidatePath } from '../../pages/api/revalidate'
import { applyTieredRateLimit, parseWindowMs } from '../../lib/rateLimit'

function req(overrides: Record<string, any> = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', host: 'jsperf.test' },
    cookies: {},
    query: {},
    body: undefined,
    socket: { remoteAddress: '203.0.113.9' },
    ...overrides,
  } as any
}

function res() {
  const r: any = { _status: 200, _json: null, revalidated: [] as string[] }
  r.status = vi.fn((code: number) => { r._status = code; return r })
  r.json = vi.fn((data: unknown) => { r._json = data; return r })
  r.end = vi.fn(() => r)
  r.setHeader = vi.fn(() => r)
  r.revalidate = vi.fn(async (path: string) => { r.revalidated.push(path) })
  return r
}

beforeEach(() => {
  state.pages = new FakeCollection([['slug', 'revision']])
  state.runs = new FakeCollection()
  state.redis = new FakeRedis()
  state.limitImpl = null
  process.env.REVALIDATE_SECRET = 'reval-secret'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/bench revision allocation', () => {
  const page = (extra: Record<string, any> = {}) => JSON.stringify({ title: 'T', tests: [{ title: 'a', code: '1+1' }], ...extra })

  it('assigns revision 1 to a fresh slug and increments for an existing one', async () => {
    const first = res()
    await benchHandler(req({ body: page() }), first)
    expect(first._json.success).toBe(true)
    expect(first._json.data.revision).toBe(1)
    const slug = first._json.data.slug
    expect(slug).toMatch(/^[a-z]{6}$/)

    const second = res()
    await benchHandler(req({ body: page({ slug }) }), second)
    expect(second._json).toMatchObject({ success: true, data: { slug, revision: 2 } })
  })

  it('recovers from a concurrent save that grabbed the same revision', async () => {
    await state.pages.insertOne({ slug: 'abcdef', revision: 1, title: 'v1', tests: [] })

    // Simulate a racing writer: the first insert attempt collides on the
    // unique (slug, revision) index because someone inserted revision 2
    // between our max(revision) read and our insert.
    const realInsert = state.pages.insertOne.bind(state.pages)
    let calls = 0
    state.pages.insertOne = async (doc: any) => {
      calls++
      if (calls === 1) {
        await realInsert({ slug: 'abcdef', revision: 2, title: 'racer', tests: [] })
      }
      return realInsert(doc)
    }

    const r = res()
    await benchHandler(req({ body: page({ slug: 'abcdef' }) }), r)
    expect(r._json).toMatchObject({ success: true, data: { slug: 'abcdef', revision: 3 } })
    expect(calls).toBe(2)
    const revisions = state.pages.docs.filter((d: any) => d.slug === 'abcdef').map((d: any) => d.revision).sort()
    expect(revisions).toEqual([1, 2, 3])
  })

  it('picks a new slug when a freshly generated one collides', async () => {
    const realInsert = state.pages.insertOne.bind(state.pages)
    let calls = 0
    let firstSlug: string | null = null
    state.pages.insertOne = async (doc: any) => {
      calls++
      if (calls === 1) {
        firstSlug = doc.slug
        await realInsert({ slug: doc.slug, revision: 1, title: 'sniped', tests: [] })
      }
      return realInsert(doc)
    }

    const r = res()
    await benchHandler(req({ body: page() }), r)
    expect(r._json.success).toBe(true)
    expect(r._json.data.revision).toBe(1)
    expect(r._json.data.slug).not.toBe(firstSlug)
    expect(r._json.data.slug).toHaveLength(6)
  })

  it('gives up after repeated duplicate-key failures instead of looping forever', async () => {
    state.pages.insertOne = async () => {
      const err: any = new Error('E11000 duplicate key')
      err.code = 11000
      throw err
    }
    const r = res()
    await benchHandler(req({ body: page({ slug: 'stuck' }) }), r)
    expect(r._json.success).toBe(false)
    expect(r._json.message).toMatch(/E11000/)
  })
})

describe('/api/bench test-case validation', () => {
  it('rejects a new benchmark with no runnable test case', async () => {
    for (const tests of [undefined, [], [{ title: 'blank', code: '' }], [{ title: 'ws', code: '   ' }]]) {
      const r = res()
      await benchHandler(req({ body: JSON.stringify({ title: 'Array', info: '<html>', tests }) }), r)
      expect(r._status).toBe(400)
      expect(r._json).toMatchObject({ success: false, message: expect.stringMatching(/at least one test case/i) })
    }
    expect(state.pages.docs).toHaveLength(0)
  })

  it('rejects replacing tests with an empty list but still allows publish-only updates', async () => {
    await state.pages.insertOne({ slug: 'abcdef', revision: 1, uuid: 'u-1', tests: [{ title: 'a', code: '1+1' }], visible: false })

    const emptied = res()
    await benchHandler(req({ method: 'PUT', body: JSON.stringify({ slug: 'abcdef', revision: 1, uuid: 'u-1', tests: [] }) }), emptied)
    expect(emptied._status).toBe(400)
    expect(emptied._json.success).toBe(false)

    const published = res()
    await benchHandler(req({ method: 'PUT', body: JSON.stringify({ slug: 'abcdef', revision: 1, uuid: 'u-1', visible: true }) }), published)
    expect(published._json).toMatchObject({ success: true })

    const doc = state.pages.docs.find((d: any) => d.slug === 'abcdef')
    expect(doc.visible).toBe(true)
    expect(doc.tests).toHaveLength(1)
  })
})

describe('POST /api/runs validation', () => {
  beforeEach(async () => {
    await state.pages.insertOne({ slug: 'abc', revision: 1, title: 'T', tests: [{ code: 'a' }, { code: 'b' }] })
  })

  const good = () => ({
    slug: 'abc',
    revision: 1,
    browserName: 'Chrome',
    browserVersion: '120',
    cpuCores: 8,
    ramGB: 0.5,
    results: [{ testIndex: 0, opsPerSec: 1000.5 }, { testIndex: 1, opsPerSec: 0 }],
  })

  it('accepts a well-formed run and invalidates the stats cache', async () => {
    await state.redis.set('stats_v3:abc:1', '{"cached":true}')
    const r = res()
    await runsHandler(req({ body: good() }), r)
    expect(r._status).toBe(200)
    expect(state.runs.docs).toHaveLength(1)
    expect(state.runs.docs[0]).toMatchObject({ slug: 'abc', revision: 1, cpuCores: 8, ramGB: 0, results: [{ testIndex: 0, opsPerSec: 1000.5 }, { testIndex: 1, opsPerSec: 0 }] })
    expect(await state.redis.get('stats_v3:abc:1')).toBeNull()
  })

  it('rejects runs for benchmarks that do not exist', async () => {
    const r = res()
    await runsHandler(req({ body: { ...good(), slug: 'nope' } }), r)
    expect(r._status).toBe(404)
    expect(state.runs.docs).toHaveLength(0)
  })

  it.each([
    ['more results than tests', { results: [{ testIndex: 0, opsPerSec: 1 }, { testIndex: 1, opsPerSec: 1 }, { testIndex: 2, opsPerSec: 1 }] }],
    ['out-of-range test index', { results: [{ testIndex: 5, opsPerSec: 1 }] }],
    ['duplicate test index', { results: [{ testIndex: 0, opsPerSec: 1 }, { testIndex: 0, opsPerSec: 2 }] }],
    ['negative opsPerSec', { results: [{ testIndex: 0, opsPerSec: -5 }] }],
    ['absurd opsPerSec', { results: [{ testIndex: 0, opsPerSec: 1e15 }] }],
    ['non-numeric opsPerSec', { results: [{ testIndex: 0, opsPerSec: 'fast' }] }],
    ['empty results', { results: [] }],
    ['bad slug', { slug: '../etc' }],
    ['zero revision', { revision: 0 }],
  ])('rejects %s', async (_label, patch) => {
    const r = res()
    await runsHandler(req({ body: { ...good(), ...patch } }), r)
    expect(r._status).toBe(400)
    expect(state.runs.docs).toHaveLength(0)
  })

  it('truncates oversized device strings', async () => {
    const r = res()
    await runsHandler(req({ body: { ...good(), browserName: 'x'.repeat(500), cpuCores: 99999 } }), r)
    expect(r._status).toBe(200)
    expect(state.runs.docs[0].browserName).toHaveLength(80)
    expect(state.runs.docs[0].cpuCores).toBe(1024)
  })
})

describe('/api/revalidate path allowlist', () => {
  it.each([
    '/', '/latest', '/abcdef', '/abcdef/3', '/array-concat-vs-push', '/u/12345',
  ])('allows %s', (path) => {
    expect(isAllowedRevalidatePath(path)).toBe(true)
  })

  it.each([
    '/api/bench', '/admin', '/admin/users', '/_next/data', '/sandbox/abc', '/r/xyz', '/u/not-a-number',
    '/abc?x=1', '/abc#frag', '//evil', '/../x', ' /abc', '/abc/def/ghi', '/abc/notanumber', 'abc', '', null, undefined, 42,
  ])('rejects %s', (path) => {
    expect(isAllowedRevalidatePath(path)).toBe(false)
  })

  it('requires the secret and an eligible path', async () => {
    const noSecret = res()
    await revalidateHandler(req({ method: 'GET', query: { path: '/abcdef' } }), noSecret)
    expect(noSecret._status).toBe(401)

    const wrongSecret = res()
    await revalidateHandler(req({ method: 'GET', query: { secret: 'nope', path: '/abcdef' } }), wrongSecret)
    expect(wrongSecret._status).toBe(401)

    const badPath = res()
    await revalidateHandler(req({ method: 'GET', query: { secret: 'reval-secret', path: '/api/bench' } }), badPath)
    expect(badPath._status).toBe(400)
    expect(badPath.revalidated).toEqual([])

    const ok = res()
    await revalidateHandler(req({ method: 'GET', query: { secret: 'reval-secret', path: '/abcdef/2' } }), ok)
    expect(ok._json).toEqual({ revalidated: true, path: '/abcdef/2' })
    expect(ok.revalidated).toEqual(['/abcdef/2'])
  })

  it('refuses when no secret is configured at all', async () => {
    delete process.env.REVALIDATE_SECRET
    const r = res()
    await revalidateHandler(req({ method: 'GET', query: { secret: '', path: '/abcdef' } }), r)
    expect(r._status).toBe(401)
  })
})

describe('rate limiter Redis outage policy', () => {
  it('falls back to an in-memory window instead of throwing or allowing unlimited', async () => {
    state.limitImpl = async () => { throw new Error('ECONNRESET') }
    const request = req({ headers: { 'x-forwarded-for': '198.51.100.7' } })

    const results = []
    for (let i = 0; i < 4; i++) results.push(await applyTieredRateLimit(request, 'outage-test', { free: 3, donor: 10, window: '1 m' }))

    expect(results.every((r) => r.degraded === true && r.tier === 'free')).toBe(true)
    expect(results.map((r) => r.success)).toEqual([true, true, true, false])
    expect(results[3].remaining).toBe(0)
  })

  it('parses windows', () => {
    expect(parseWindowMs('1 m')).toBe(60_000)
    expect(parseWindowMs('30 s')).toBe(30_000)
    expect(parseWindowMs('2 h')).toBe(7_200_000)
    expect(parseWindowMs('garbage')).toBe(60_000)
  })
})
