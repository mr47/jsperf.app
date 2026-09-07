import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCollection, FakeRedis } from '../helpers/fakeMongo'

const state = vi.hoisted(() => ({
  users: null as any,
  pages: null as any,
  ipBans: null as any,
  audit: null as any,
  redis: null as any,
  token: null as any,
}))

vi.mock('../../lib/redis', () => ({ redis: new Proxy({}, { get: (_t, prop) => (state.redis as any)[prop] }) }))
vi.mock('../../lib/mongodb', () => ({
  usersCollection: vi.fn(async () => state.users),
  pagesCollection: vi.fn(async () => state.pages),
  ipBansCollection: vi.fn(async () => state.ipBans),
  adminAuditCollection: vi.fn(async () => state.audit),
  errorsCollection: vi.fn(async () => new FakeCollection()),
}))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => state.token) }))
vi.mock('../../lib/donatello', () => ({ findDonorByEmail: vi.fn(async () => null) }))

import banHandler from '../../pages/api/admin/users/[id]/ban'
import premiumHandler from '../../pages/api/admin/users/[id]/premium'
import ipBansHandler from '../../pages/api/admin/ip-bans'
import { findActiveBan, recordSignIn } from '../../lib/users'
import { rejectIfBanned } from '../../lib/bans'
import { getDonorFromRequest } from '../../lib/donorAuth'

const ADMIN = { user: { id: '1', email: 'admin@example.com', profile: { login: 'admin' } } }
const TARGET = { id: '99', login: 'spammer', name: 'Spam Bot', email: 'Spam@Example.com', emails: ['spam@example.com', 'alt@example.com'], image: null }

function req(overrides: Record<string, any> = {}) {
  return {
    method: 'GET',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.9' },
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

describe('admin moderation flows', () => {
  beforeEach(async () => {
    state.users = new FakeCollection([['githubId']])
    state.pages = new FakeCollection()
    state.ipBans = new FakeCollection([['ip']])
    state.audit = new FakeCollection()
    state.redis = new FakeRedis()
    state.token = ADMIN
    process.env.NEXTAUTH_SECRET = 'test-secret'
    process.env.ADMIN_GITHUB_IDS = '1'

    await recordSignIn(TARGET)
    await state.pages.insertOne({ slug: 'abc', revision: 1, title: 'One', githubID: '99', visible: true, tests: [] })
    await state.pages.insertOne({ slug: 'abc', revision: 2, title: 'One v2', githubID: '99', visible: true, tests: [] })
    await state.pages.insertOne({ slug: 'old', revision: 1, title: 'Already hidden', githubID: '99', visible: false, tests: [] })
    await state.pages.insertOne({ slug: 'other', revision: 1, title: 'Someone else', githubID: '5', visible: true, tests: [] })
  })

  it('records sign-ins in the directory', async () => {
    const doc = await state.users.findOne({ githubId: '99' })
    expect(doc).toMatchObject({ login: 'spammer', email: 'spam@example.com', emails: ['spam@example.com', 'alt@example.com'], signInCount: 1, source: 'signin' })
    await recordSignIn(TARGET)
    expect((await state.users.findOne({ githubId: '99' })).signInCount).toBe(2)
  })

  it('bans a user, hides their content, blocks writes, and restores on unban', async () => {
    const banRes = res()
    await banHandler(req({ method: 'POST', query: { id: '99' }, body: { reason: 'Spam benchmarks', hideContent: true } }), banRes)
    expect(banRes._status).toBe(200)
    expect(banRes._json).toMatchObject({ success: true, hiddenPages: 2, revalidated: 2 })
    expect(banRes.revalidated.sort()).toEqual(['/abc', '/abc/2'])

    const user = await state.users.findOne({ githubId: '99' })
    expect(user.ban).toMatchObject({ reason: 'Spam benchmarks', by: 'admin', until: null })
    expect(user.ban.hiddenPageIds).toHaveLength(2)
    expect((await state.pages.find({ githubID: '99', visible: true }).toArray())).toHaveLength(0)
    expect((await state.pages.findOne({ slug: 'other' })).visible).toBe(true)

    // Hot-path enforcement reads Redis only.
    expect(await findActiveBan({ githubId: '99' })).toMatchObject({ kind: 'user', reason: 'Spam benchmarks' })
    expect(await findActiveBan({ githubId: '5' })).toBeNull()

    state.token = { user: { id: '99', email: 'spam@example.com' } }
    const writeRes = res()
    expect(await rejectIfBanned(req({ method: 'POST' }), writeRes)).toBe(true)
    expect(writeRes._status).toBe(403)
    expect(writeRes._json.error).toBe('banned')

    // Sign-in callback sees the ban on the directory record.
    const record = await recordSignIn(TARGET)
    expect(record?.ban).toBeTruthy()

    state.token = ADMIN
    const unbanRes = res()
    await banHandler(req({ method: 'DELETE', query: { id: '99' } }), unbanRes)
    expect(unbanRes._json).toMatchObject({ success: true, restoredPages: 2 })
    expect((await state.pages.find({ githubID: '99', visible: true }).toArray())).toHaveLength(2)
    expect((await state.pages.findOne({ slug: 'old' })).visible).toBe(false)
    expect(await findActiveBan({ githubId: '99' })).toBeNull()
    expect((await state.users.findOne({ githubId: '99' })).ban).toBeNull()

    const actions = state.audit.docs.map((d: any) => d.action)
    expect(actions).toEqual(['user.ban', 'user.unban'])
  })

  it('applies temporary bans with an expiry', async () => {
    const r = res()
    await banHandler(req({ method: 'POST', query: { id: '99' }, body: { reason: 'Cooling off', days: 2 } }), r)
    expect(r._status).toBe(200)
    const until = Date.parse(r._json.ban.until)
    expect(until - Date.now()).toBeGreaterThan(1.9 * 86400_000)
    expect(state.redis.ttl('ban:gh:99')).toBeGreaterThan(86400)
  })

  it('refuses self-bans and requires a reason', async () => {
    const self = res()
    await banHandler(req({ method: 'POST', query: { id: '1' }, body: { reason: 'oops' } }), self)
    expect(self._status).toBe(400)

    const noReason = res()
    await banHandler(req({ method: 'POST', query: { id: '99' }, body: {} }), noReason)
    expect(noReason._status).toBe(400)
  })

  it('bans and unbans IP addresses used by anonymous writers', async () => {
    const add = res()
    await ipBansHandler(req({ method: 'POST', body: { ip: '203.0.113.9', reason: 'Flooding runs' } }), add)
    expect(add._status).toBe(200)

    state.token = null
    const anon = res()
    expect(await rejectIfBanned(req({ method: 'POST' }), anon)).toBe(true)
    expect(anon._json.message).toContain('Flooding runs')

    const otherIp = res()
    expect(await rejectIfBanned(req({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.1' } }), otherIp)).toBe(false)

    state.token = ADMIN
    const remove = res()
    await ipBansHandler(req({ method: 'DELETE', query: { ip: '203.0.113.9' } }), remove)
    expect(remove._status).toBe(200)
    state.token = null
    expect(await rejectIfBanned(req({ method: 'POST' }), res())).toBe(false)

    const bad = res()
    state.token = ADMIN
    await ipBansHandler(req({ method: 'POST', body: { ip: 'not an ip', reason: 'x' } }), bad)
    expect(bad._status).toBe(400)
  })

  it('grants a donor boost that getDonorFromRequest honours, then revokes it', async () => {
    const grant = res()
    await premiumHandler(req({ method: 'POST', query: { id: '99' }, body: { days: 30, tierName: 'Contributor', note: 'Fixed the runner' } }), grant)
    expect(grant._status).toBe(200)
    expect(grant._json.grant).toMatchObject({ tierName: 'Contributor', grantedBy: 'admin', note: 'Fixed the runner' })

    // Resolved by GitHub id...
    const byId = await getDonorFromRequest(req(), { sessionUserId: '99', sessionEmail: null })
    expect(byId).toMatchObject({ via: 'grant', source: 'grant', tierName: 'Contributor', name: 'spammer' })
    // ...and by any email GitHub shared.
    const byEmail = await getDonorFromRequest(req(), { sessionEmail: 'ALT@example.com' })
    expect(byEmail).toMatchObject({ via: 'grant' })
    // Strangers stay on the free tier.
    expect(await getDonorFromRequest(req(), { sessionUserId: '5', sessionEmail: 'nobody@example.com' })).toBeNull()

    const revoke = res()
    await premiumHandler(req({ method: 'DELETE', query: { id: '99' } }), revoke)
    expect(revoke._status).toBe(200)
    expect(await getDonorFromRequest(req(), { sessionUserId: '99', sessionEmail: 'spam@example.com' })).toBeNull()
    expect((await state.users.findOne({ githubId: '99' })).donorGrant).toBeNull()
  })

  it('validates grant duration and requires a directory entry', async () => {
    const tooLong = res()
    await premiumHandler(req({ method: 'POST', query: { id: '99' }, body: { days: 99999 } }), tooLong)
    expect(tooLong._status).toBe(400)

    const unknown = res()
    await premiumHandler(req({ method: 'POST', query: { id: '12345' }, body: { days: 7 } }), unknown)
    expect(unknown._status).toBe(409)
  })

  it('denies moderation endpoints to non-admins', async () => {
    state.token = { user: { id: '5', email: 'user@example.com' } }
    const r = res()
    await banHandler(req({ method: 'POST', query: { id: '99' }, body: { reason: 'nope' } }), r)
    expect(r._status).toBe(403)
    expect(await findActiveBan({ githubId: '99' })).toBeNull()
  })
})
