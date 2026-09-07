import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCollection } from '../helpers/fakeMongo'

const state = vi.hoisted(() => ({ errors: null as any, fail: false }))

vi.mock('../../lib/mongodb', () => ({
  errorsCollection: vi.fn(async () => {
    if (state.fail) throw new Error('mongo down')
    return state.errors
  }),
}))
vi.mock('../../lib/redis', () => ({ redis: {} }))
vi.mock('@upstash/ratelimit', () => {
  class RatelimitMock {
    async limit() { return { success: true } }
    static slidingWindow() { return {} }
  }
  return { Ratelimit: RatelimitMock }
})

import { fingerprintError, listErrors, logServerError, resolveErrors } from '../../lib/errorLog'
import clientErrorsHandler from '../../pages/api/errors'

describe('error log', () => {
  beforeEach(() => {
    state.errors = new FakeCollection([['fingerprint', 'bucket']])
    state.fail = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('fingerprints ignore volatile numbers, ids and quoted strings', () => {
    const a = fingerprintError('bench.create', 'Page "abc" revision 12 failed for 0x1f2e3d4c5b6a', null)
    const b = fingerprintError('bench.create', 'Page "xyz" revision 7 failed for deadbeefcafe', null)
    const c = fingerprintError('bench.update', 'Page "xyz" revision 7 failed for deadbeefcafe', null)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('groups repeated errors into one document per fingerprint and hour', async () => {
    const err = new Error('Mongo insert failed for slug 123')
    await logServerError('bench.create', err, { req: { method: 'POST', url: '/api/bench', headers: { 'x-forwarded-for': '1.2.3.4' } } as any, userId: 'u1' })
    await logServerError('bench.create', new Error('Mongo insert failed for slug 456'), { req: { method: 'POST', url: '/api/bench', headers: {} } as any })

    expect(state.errors.docs).toHaveLength(1)
    const doc = state.errors.docs[0]
    expect(doc.count).toBe(2)
    expect(doc.scope).toBe('bench.create')
    expect(doc.source).toBe('server')
    expect(doc.resolvedAt).toBeNull()
    expect(doc.samples).toHaveLength(2)
    expect(doc.samples[0]).toMatchObject({ method: 'POST', url: '/api/bench', ip: '1.2.3.4', userId: 'u1' })
    expect(doc.message).toContain('slug 456')

    await logServerError('other.scope', new Error('Different'), {})
    expect(state.errors.docs).toHaveLength(2)
  })

  it('never throws when persistence fails', async () => {
    state.fail = true
    await expect(logServerError('x', new Error('boom'))).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  it('lists, filters and resolves groups', async () => {
    await logServerError('a', new Error('first'))
    await logServerError('b', new Error('second'), { source: 'client' })

    const open = await listErrors({ status: 'open' })
    expect(open.total).toBe(2)
    expect(open.scopes).toEqual(['a', 'b'])

    const clientOnly = await listErrors({ source: 'client' })
    expect(clientOnly.items.map((i) => i.scope)).toEqual(['b'])

    const searched = await listErrors({ q: 'FIRST' })
    expect(searched.items.map((i) => i.scope)).toEqual(['a'])

    const modified = await resolveErrors([open.items[0]._id], true)
    expect(modified).toBe(1)
    expect((await listErrors({ status: 'open' })).total).toBe(1)
    expect((await listErrors({ status: 'resolved' })).total).toBe(1)
  })

  it('accepts browser reports through /api/errors and tags them as client errors', async () => {
    const res: any = { status: vi.fn(() => res), end: vi.fn(() => res), setHeader: vi.fn(() => res) }
    await clientErrorsHandler({
      method: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.9' },
      socket: { remoteAddress: '9.9.9.9' },
      body: { message: 'Cannot read properties of undefined', stack: 'TypeError: x\n    at run (app.js:1:1)', url: 'https://jsperf.app/abc', source: 'error' },
    } as any, res)
    expect(res.status).toHaveBeenCalledWith(204)
    expect(state.errors.docs).toHaveLength(1)
    expect(state.errors.docs[0]).toMatchObject({ scope: 'client', source: 'client' })
    expect(state.errors.docs[0].samples[0]).toMatchObject({ pageUrl: 'https://jsperf.app/abc', kind: 'error', ip: '9.9.9.9' })

    // Empty / non-POST reports are ignored quietly.
    await clientErrorsHandler({ method: 'POST', headers: {}, socket: {}, body: {} } as any, res)
    expect(state.errors.docs).toHaveLength(1)
  })
})
