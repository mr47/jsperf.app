/**
 * User directory + moderation state.
 *
 * jsPerf has no classic accounts table: identity is a GitHub id inside a
 * NextAuth JWT, and benchmark ownership is `pages.githubID`. The `users`
 * collection is a lightweight directory that gets upserted on every
 * sign-in so the admin panel has something to list, search and act on.
 *
 * Moderation state lives on the same document:
 *   role        'admin' | null            promoted from the panel (env allowlist also works)
 *   ban         { reason, at, by, until?, hiddenPageIds[] } | null
 *   donorGrant  { tierName, note, grantedAt, grantedBy, expiresAt } | null
 *
 * Bans and grants are mirrored into Redis so hot paths (rate limiter,
 * write APIs) never touch MongoDB:
 *   ban:gh:<githubId>            JSON BanRecord   (EX until `until`, or persistent)
 *   ban:ip:<ip>                  JSON BanRecord
 *   donor:grant:gh:<githubId>    JSON donor session (EX until expiry)
 *   donor:grant:email:<email>    JSON donor session (EX until expiry)
 */
import { redis } from './redis'
import { adminAuditCollection, ipBansCollection, pagesCollection, usersCollection } from './mongodb'

export type BanRecord = {
  reason: string
  at: string
  by: string
  until: string | null
  hiddenPageIds?: string[]
}

export type DonorGrant = {
  tierName: string
  note: string | null
  grantedAt: string
  grantedBy: string
  expiresAt: string
}

export type UserDoc = {
  githubId: string
  login: string | null
  name: string | null
  email: string | null
  emails: string[]
  image: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  signInCount: number
  source: 'signin' | 'pages'
  pageCount?: number
  role?: 'admin' | null
  ban?: BanRecord | null
  donorGrant?: DonorGrant | null
}

export type AdminActor = { id: string; login: string | null }

const BAN_GH_KEY = (id: string) => `ban:gh:${id}`
const BAN_IP_KEY = (ip: string) => `ban:ip:${ip}`
const GRANT_GH_KEY = (id: string) => `donor:grant:gh:${id}`
const GRANT_EMAIL_KEY = (email: string) => `donor:grant:email:${email.toLowerCase()}`

const MAX_HIDDEN_PAGES_PER_BAN = 5000

function nowIso() {
  return new Date().toISOString()
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as T
  if (typeof raw !== 'string') return null
  try { return JSON.parse(raw) as T } catch (_) { return null }
}

function secondsUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms)) return null
  return Math.max(1, Math.ceil(ms / 1000))
}

async function redisSetJson(key: string, value: unknown, exSeconds: number | null) {
  const payload = JSON.stringify(value)
  if (exSeconds) await redis.set(key, payload, { ex: exSeconds })
  else await redis.set(key, payload)
}

export function normalizeGithubId(value: unknown): string | null {
  if (value == null) return null
  const str = String(value).trim()
  return /^\d{1,20}$/.test(str) ? str : null
}

export function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ip = value.trim()
  if (!ip || ip.length > 64) return null
  // Loose check: IPv4 dotted quad or IPv6 hex/colon form.
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return null
  return ip
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export type SignInIdentity = {
  id: string
  login?: string | null
  name?: string | null
  email?: string | null
  emails?: string[]
  image?: string | null
}

/**
 * Upsert the directory entry for a sign-in. Returns the stored doc so the
 * auth callback can check `ban` / `role` in the same round trip.
 */
export async function recordSignIn(identity: SignInIdentity): Promise<UserDoc | null> {
  const githubId = normalizeGithubId(identity.id)
  if (!githubId) return null
  const users = await usersCollection()
  const now = new Date()
  const $set: Record<string, unknown> = { lastSeenAt: now, source: 'signin' }
  if (identity.login) $set.login = identity.login
  if (identity.name) $set.name = identity.name
  if (identity.email) $set.email = identity.email.toLowerCase()
  if (Array.isArray(identity.emails) && identity.emails.length) {
    $set.emails = identity.emails.map((e) => String(e).toLowerCase())
  }
  if (identity.image) $set.image = identity.image

  const result = await users.findOneAndUpdate(
    { githubId },
    {
      $set,
      $setOnInsert: { githubId, firstSeenAt: now },
      $inc: { signInCount: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )
  return (result?.value as UserDoc | null) ?? null
}

export async function findUserByGithubId(githubId: string): Promise<UserDoc | null> {
  const id = normalizeGithubId(githubId)
  if (!id) return null
  const users = await usersCollection()
  return (await users.findOne({ githubId: id })) as UserDoc | null
}

export type UserListFilter = 'all' | 'banned' | 'premium' | 'admins'

export async function listUsers({
  q = '',
  filter = 'all',
  page = 1,
  pageSize = 25,
}: { q?: string; filter?: UserListFilter; page?: number; pageSize?: number }) {
  const users = await usersCollection()
  const query: Record<string, unknown> = {}
  const trimmed = q.trim()
  if (trimmed) {
    if (/^\d+$/.test(trimmed)) {
      query.githubId = trimmed
    } else {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(escaped, 'i')
      query.$or = [{ login: re }, { name: re }, { email: re }, { emails: re }]
    }
  }
  if (filter === 'banned') query.ban = { $ne: null }
  if (filter === 'premium') query['donorGrant.expiresAt'] = { $gt: nowIso() }
  if (filter === 'admins') query.role = 'admin'

  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const [items, total] = await Promise.all([
    users.find(query, { projection: { _id: 0 } })
      .sort({ lastSeenAt: -1 })
      .skip((safePage - 1) * safeSize)
      .limit(safeSize)
      .toArray(),
    users.countDocuments(query, { maxTimeMS: 5000 }),
  ])
  return { items: items as unknown as UserDoc[], total, page: safePage, pageSize: safeSize }
}

/**
 * Seed the directory from historical `pages.githubID` values so authors
 * who never sign in again still show up (with their benchmark counts).
 * One aggregation over the pages collection — admin-triggered only.
 */
export async function backfillUsersFromPages(): Promise<{ scanned: number; upserted: number }> {
  const pages = await pagesCollection()
  const users = await usersCollection()
  const cursor = pages.aggregate([
    { $match: { githubID: { $type: 'string', $ne: '' } } },
    {
      $group: {
        _id: '$githubID',
        pageCount: { $sum: 1 },
        firstSeenAt: { $min: '$published' },
        lastSeenAt: { $max: '$published' },
        authorName: { $last: '$authorName' },
      },
    },
  ], { allowDiskUse: true })

  let scanned = 0
  let upserted = 0
  let batch: Array<Record<string, unknown>> = []
  const flush = async () => {
    if (!batch.length) return
    const result = await users.bulkWrite(batch as any[], { ordered: false })
    upserted += result.upsertedCount || 0
    batch = []
  }

  for await (const row of cursor) {
    const githubId = normalizeGithubId(row._id)
    if (!githubId) continue
    scanned += 1
    const firstSeenAt = row.firstSeenAt instanceof Date ? row.firstSeenAt : new Date()
    const lastSeenAt = row.lastSeenAt instanceof Date ? row.lastSeenAt : firstSeenAt
    batch.push({
      updateOne: {
        filter: { githubId },
        update: {
          $set: { pageCount: row.pageCount || 0 },
          $setOnInsert: {
            githubId,
            login: null,
            name: typeof row.authorName === 'string' ? row.authorName : null,
            email: null,
            emails: [],
            image: null,
            firstSeenAt,
            lastSeenAt,
            signInCount: 0,
            source: 'pages',
          },
        },
        upsert: true,
      },
    })
    if (batch.length >= 500) await flush()
  }
  await flush()
  return { scanned, upserted }
}

export async function listUserBenchmarks(githubId: string, limit = 50) {
  const pages = await pagesCollection()
  return pages.aggregate([
    { $match: { githubID: githubId } },
    { $sort: { slug: 1, revision: -1 } },
    {
      $group: {
        _id: '$slug',
        revisionCount: { $sum: 1 },
        title: { $first: '$title' },
        revision: { $first: '$revision' },
        published: { $first: '$published' },
        visible: { $first: '$visible' },
        testsCount: { $first: { $size: { $ifNull: ['$tests', []] } } },
      },
    },
    { $sort: { published: -1 } },
    { $limit: limit },
    { $project: { _id: 0, slug: '$_id', title: 1, revision: 1, revisionCount: 1, published: 1, visible: 1, testsCount: 1 } },
  ], { allowDiskUse: true }).toArray()
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function setUserRole(githubId: string, role: 'admin' | null, actor: AdminActor) {
  const id = normalizeGithubId(githubId)
  if (!id) throw new Error('Invalid GitHub id')
  const users = await usersCollection()
  await users.updateOne({ githubId: id }, { $set: { role } }, { upsert: false })
  await writeAudit({ action: role ? 'role.grant' : 'role.revoke', actor, targetType: 'user', targetId: id, details: { role } })
}

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

export type BanInput = {
  reason: string
  /** Duration in days; omit or 0 for permanent. */
  days?: number | null
  /** Also set `visible: false` on all benchmarks the user authored. */
  hideContent?: boolean
}

export async function banUser(githubId: string, input: BanInput, actor: AdminActor): Promise<BanRecord> {
  const id = normalizeGithubId(githubId)
  if (!id) throw new Error('Invalid GitHub id')
  const reason = String(input.reason || '').trim().slice(0, 500) || 'No reason given'
  const days = Number(input.days) || 0
  const until = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null

  const users = await usersCollection()
  const existing = (await users.findOne({ githubId: id }, { projection: { ban: 1 } })) as Pick<UserDoc, 'ban'> | null
  const hiddenPageIds: string[] = existing?.ban?.hiddenPageIds ? [...existing.ban.hiddenPageIds] : []

  if (input.hideContent) {
    const pages = await pagesCollection()
    const docs = await pages
      .find({ githubID: id, visible: true }, { projection: { _id: 1 } })
      .limit(MAX_HIDDEN_PAGES_PER_BAN)
      .toArray()
    if (docs.length) {
      await pages.updateMany({ _id: { $in: docs.map((d) => d._id) } }, { $set: { visible: false } })
      for (const d of docs) hiddenPageIds.push(String(d._id))
    }
  }

  const ban: BanRecord = { reason, at: nowIso(), by: actor.login || actor.id, until, hiddenPageIds }
  await users.updateOne(
    { githubId: id },
    {
      $set: { ban },
      $setOnInsert: {
        githubId: id, login: null, name: null, email: null, emails: [], image: null,
        firstSeenAt: new Date(), lastSeenAt: new Date(), signInCount: 0, source: 'pages',
      },
    },
    { upsert: true },
  )
  await redisSetJson(BAN_GH_KEY(id), { reason, at: ban.at, by: ban.by, until }, secondsUntil(until))
  await writeAudit({ action: 'user.ban', actor, targetType: 'user', targetId: id, details: { reason, until, hiddenPages: hiddenPageIds.length } })
  return ban
}

export async function unbanUser(githubId: string, actor: AdminActor): Promise<{ restoredPages: number }> {
  const id = normalizeGithubId(githubId)
  if (!id) throw new Error('Invalid GitHub id')
  const users = await usersCollection()
  const existing = (await users.findOne({ githubId: id }, { projection: { ban: 1 } })) as Pick<UserDoc, 'ban'> | null
  let restoredPages = 0
  const hidden = existing?.ban?.hiddenPageIds || []
  if (hidden.length) {
    const { ObjectId } = await import('mongodb')
    const ids = hidden
      .map((h) => { try { return new ObjectId(h) } catch (_) { return null } })
      .filter((v): v is InstanceType<typeof ObjectId> => v !== null)
    if (ids.length) {
      const pages = await pagesCollection()
      const result = await pages.updateMany({ _id: { $in: ids } }, { $set: { visible: true } })
      restoredPages = result.modifiedCount || 0
    }
  }
  await users.updateOne({ githubId: id }, { $set: { ban: null } })
  await redis.del(BAN_GH_KEY(id))
  await writeAudit({ action: 'user.unban', actor, targetType: 'user', targetId: id, details: { restoredPages } })
  return { restoredPages }
}

export async function banIp(ip: string, reason: string, days: number | null | undefined, actor: AdminActor) {
  const safeIp = normalizeIp(ip)
  if (!safeIp) throw new Error('Invalid IP address')
  const safeReason = String(reason || '').trim().slice(0, 500) || 'No reason given'
  const until = days && days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null
  const record: BanRecord = { reason: safeReason, at: nowIso(), by: actor.login || actor.id, until }
  const bans = await ipBansCollection()
  await bans.updateOne({ ip: safeIp }, { $set: { ip: safeIp, ...record } }, { upsert: true })
  await redisSetJson(BAN_IP_KEY(safeIp), record, secondsUntil(until))
  await writeAudit({ action: 'ip.ban', actor, targetType: 'ip', targetId: safeIp, details: { reason: safeReason, until } })
  return { ip: safeIp, ...record }
}

export async function unbanIp(ip: string, actor: AdminActor) {
  const safeIp = normalizeIp(ip)
  if (!safeIp) throw new Error('Invalid IP address')
  const bans = await ipBansCollection()
  await bans.deleteOne({ ip: safeIp })
  await redis.del(BAN_IP_KEY(safeIp))
  await writeAudit({ action: 'ip.unban', actor, targetType: 'ip', targetId: safeIp, details: {} })
}

export async function listIpBans(limit = 200) {
  const bans = await ipBansCollection()
  return bans.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray()
}

/** Hot-path check: one Redis MGET, never throws. */
export async function findActiveBan({ githubId, ip }: { githubId?: string | null; ip?: string | null }): Promise<(BanRecord & { kind: 'user' | 'ip' }) | null> {
  const keys: string[] = []
  const kinds: Array<'user' | 'ip'> = []
  const id = githubId ? normalizeGithubId(githubId) : null
  const safeIp = ip ? normalizeIp(ip) : null
  if (id) { keys.push(BAN_GH_KEY(id)); kinds.push('user') }
  if (safeIp) { keys.push(BAN_IP_KEY(safeIp)); kinds.push('ip') }
  if (!keys.length) return null
  try {
    const values = await redis.mget<unknown[]>(...keys)
    for (let i = 0; i < values.length; i++) {
      const record = parseJson<BanRecord>(values[i])
      if (!record) continue
      if (record.until && Date.parse(record.until) <= Date.now()) continue
      return { ...record, kind: kinds[i] }
    }
  } catch (_) {
    // Redis blip: fail open, the request is still rate-limited.
  }
  return null
}

// ---------------------------------------------------------------------------
// Admin-granted donor boost ("premium without donation")
// ---------------------------------------------------------------------------

export type GrantInput = {
  days: number
  tierName?: string | null
  note?: string | null
}

function grantToDonorSession(grant: DonorGrant, user: Pick<UserDoc, 'githubId' | 'login' | 'name' | 'email'>) {
  return {
    name: user.login || user.name || `github:${user.githubId}`,
    source: 'grant',
    amount: 0,
    currency: 'UAH',
    tierName: grant.tierName,
    email: user.email || null,
    via: 'grant',
    promoCode: null,
    githubId: user.githubId,
    createdAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
  }
}

export async function grantDonor(githubId: string, input: GrantInput, actor: AdminActor): Promise<DonorGrant> {
  const id = normalizeGithubId(githubId)
  if (!id) throw new Error('Invalid GitHub id')
  const days = Math.min(3650, Math.max(1, Math.floor(Number(input.days) || 0)))
  if (!days) throw new Error('Grant duration must be at least one day')
  const users = await usersCollection()
  const user = (await users.findOne({ githubId: id })) as UserDoc | null
  if (!user) throw new Error('User has not signed in yet, so a grant cannot be attached to them')

  const grant: DonorGrant = {
    tierName: String(input.tierName || 'Admin grant').trim().slice(0, 80) || 'Admin grant',
    note: input.note ? String(input.note).trim().slice(0, 500) : null,
    grantedAt: nowIso(),
    grantedBy: actor.login || actor.id,
    expiresAt: new Date(Date.now() + days * 86400_000).toISOString(),
  }
  await users.updateOne({ githubId: id }, { $set: { donorGrant: grant } })

  const session = grantToDonorSession(grant, user)
  const ttl = secondsUntil(grant.expiresAt)
  await redisSetJson(GRANT_GH_KEY(id), session, ttl)
  const emails = new Set<string>([user.email, ...(user.emails || [])].filter((e): e is string => !!e).map((e) => e.toLowerCase()))
  for (const email of emails) await redisSetJson(GRANT_EMAIL_KEY(email), session, ttl)

  await writeAudit({ action: 'donor.grant', actor, targetType: 'user', targetId: id, details: { days, tierName: grant.tierName, note: grant.note } })
  return grant
}

export async function revokeDonorGrant(githubId: string, actor: AdminActor) {
  const id = normalizeGithubId(githubId)
  if (!id) throw new Error('Invalid GitHub id')
  const users = await usersCollection()
  const user = (await users.findOne({ githubId: id })) as UserDoc | null
  await users.updateOne({ githubId: id }, { $set: { donorGrant: null } })
  const keys = [GRANT_GH_KEY(id)]
  const emails = new Set<string>([user?.email, ...(user?.emails || [])].filter((e): e is string => !!e).map((e) => e.toLowerCase()))
  for (const email of emails) keys.push(GRANT_EMAIL_KEY(email))
  await redis.del(...keys)
  await writeAudit({ action: 'donor.revoke', actor, targetType: 'user', targetId: id, details: {} })
}

/** Hot-path lookup used by `getDonorFromRequest`; never throws. */
export async function findDonorGrant({ githubId, email }: { githubId?: string | null; email?: string | null }) {
  const keys: string[] = []
  const id = githubId ? normalizeGithubId(githubId) : null
  if (id) keys.push(GRANT_GH_KEY(id))
  if (email && typeof email === 'string' && email.includes('@')) keys.push(GRANT_EMAIL_KEY(email))
  if (!keys.length) return null
  try {
    const values = await redis.mget<unknown[]>(...keys)
    for (const value of values) {
      const session = parseJson<Record<string, unknown>>(value)
      if (session) return session
    }
  } catch (_) {
    // fall through — treated as "no grant"
  }
  return null
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditEntry = {
  action: string
  actor: AdminActor
  targetType: 'user' | 'ip' | 'error' | 'system'
  targetId: string
  details: Record<string, unknown>
}

export async function writeAudit(entry: AuditEntry) {
  try {
    const audit = await adminAuditCollection()
    await audit.insertOne({
      action: entry.action,
      actorId: entry.actor.id,
      actorLogin: entry.actor.login,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details,
      createdAt: new Date(),
    })
  } catch (err) {
    console.warn('[admin-audit] write failed', (err as Error)?.message || err)
  }
}

export async function listAudit({ targetType, targetId, limit = 50 }: { targetType?: string; targetId?: string; limit?: number } = {}) {
  const audit = await adminAuditCollection()
  const query: Record<string, unknown> = {}
  if (targetType) query.targetType = targetType
  if (targetId) query.targetId = targetId
  return audit.find(query, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(Math.min(200, limit)).toArray()
}
