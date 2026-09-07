import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCollection, FakeRedis } from '../helpers/fakeMongo'

const state = vi.hoisted(() => ({
  users: null as any,
  redis: null as any,
  token: null as any,
}))

vi.mock('../../lib/redis', () => ({ redis: new Proxy({}, { get: (_t, prop) => (state.redis as any)[prop] }) }))
vi.mock('../../lib/mongodb', () => ({
  usersCollection: vi.fn(async () => state.users),
  adminAuditCollection: vi.fn(async () => new FakeCollection()),
  ipBansCollection: vi.fn(async () => new FakeCollection()),
  pagesCollection: vi.fn(async () => new FakeCollection()),
  errorsCollection: vi.fn(async () => new FakeCollection()),
}))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => state.token) }))

import { requireAdmin, requireAdminSsr, isAdminUser } from '../../lib/admin'
import { normalizeSessionToken } from '../../lib/session'

function req(overrides: Record<string, any> = {}) {
  return { method: 'GET', headers: {}, cookies: {}, socket: { remoteAddress: '127.0.0.1' }, ...overrides } as any
}

function res() {
  const r: any = { _status: 200, _json: null }
  r.status = vi.fn((code: number) => { r._status = code; return r })
  r.json = vi.fn((data: unknown) => { r._json = data; return r })
  r.setHeader = vi.fn(() => r)
  return r
}

const ADMIN_TOKEN = { user: { id: '42', email: 'admin@example.com', profile: { login: 'AdminUser' } } }
const REGULAR_TOKEN = { user: { id: '7', email: 'user@example.com', profile: { login: 'someone' } } }

describe('admin authorisation', () => {
  beforeEach(() => {
    state.users = new FakeCollection([['githubId']])
    state.redis = new FakeRedis()
    state.token = null
    process.env.NEXTAUTH_SECRET = 'test-secret'
    delete process.env.ADMIN_GITHUB_IDS
    delete process.env.ADMIN_GITHUB_LOGINS
  })

  it('normalises the NextAuth token shape', () => {
    expect(normalizeSessionToken(null)).toBeNull()
    expect(normalizeSessionToken(ADMIN_TOKEN)).toMatchObject({ id: '42', email: 'admin@example.com', login: 'AdminUser', isAdmin: false })
    expect(normalizeSessionToken({ ...ADMIN_TOKEN, isAdmin: true })?.isAdmin).toBe(true)
  })

  it('rejects anonymous callers with 401', async () => {
    const r = res()
    expect(await requireAdmin(req(), r)).toBeNull()
    expect(r._status).toBe(401)
  })

  it('rejects signed-in non-admins with 403', async () => {
    state.token = REGULAR_TOKEN
    const r = res()
    expect(await requireAdmin(req(), r)).toBeNull()
    expect(r._status).toBe(403)
  })

  it('accepts admins from the env login allowlist (case-insensitive)', async () => {
    process.env.ADMIN_GITHUB_LOGINS = 'other, adminuser'
    state.token = ADMIN_TOKEN
    const r = res()
    const admin = await requireAdmin(req(), r)
    expect(admin?.id).toBe('42')
    expect(r.status).not.toHaveBeenCalled()
  })

  it('accepts admins from the env id allowlist', async () => {
    process.env.ADMIN_GITHUB_IDS = '42'
    expect(await isAdminUser({ id: '42', login: null })).toBe(true)
    expect(await isAdminUser({ id: '43', login: null })).toBe(false)
  })

  it('accepts admins promoted in the users collection', async () => {
    await state.users.insertOne({ githubId: '7', role: 'admin' })
    state.token = REGULAR_TOKEN
    const r = res()
    expect((await requireAdmin(req(), r))?.id).toBe('7')
  })

  it('rejects cross-site mutations and non-JSON bodies', async () => {
    process.env.ADMIN_GITHUB_IDS = '42'
    state.token = ADMIN_TOKEN

    const crossSite = res()
    expect(await requireAdmin(req({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } }), crossSite)).toBeNull()
    expect(crossSite._status).toBe(403)

    const form = res()
    expect(await requireAdmin(req({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), form)).toBeNull()
    expect(form._status).toBe(415)

    const ok = res()
    expect(await requireAdmin(req({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }), ok)).not.toBeNull()

    const del = res()
    expect(await requireAdmin(req({ method: 'DELETE', headers: {} }), del)).not.toBeNull()
  })

  it('SSR guard redirects anonymous users and hides the panel from non-admins', async () => {
    const anon = await requireAdminSsr({ req: req(), resolvedUrl: '/admin/users' } as any)
    expect(anon).toMatchObject({ redirect: { destination: '/api/auth/signin?callbackUrl=%2Fadmin%2Fusers' } })

    state.token = REGULAR_TOKEN
    expect(await requireAdminSsr({ req: req(), resolvedUrl: '/admin' } as any)).toEqual({ notFound: true })

    process.env.ADMIN_GITHUB_IDS = '7'
    const admin = await requireAdminSsr({ req: req(), resolvedUrl: '/admin' } as any)
    expect('admin' in admin && admin.admin.id).toBe('7')
  })
})
