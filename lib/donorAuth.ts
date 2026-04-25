// @ts-nocheck
/**
 * Donor session storage + cookie helpers.
 *
 * A "donor session" is a small record kept in Redis under a random
 * opaque token. The token is handed back to the browser as an HttpOnly
 * cookie; subsequent API requests use it to look up the donor and pick
 * the donor-tier rate limiter.
 *
 * We deliberately don't sign the cookie — possession of a valid token
 * is enough because the only thing it grants is a more generous rate
 * limit. There is no PII, no write capability, and the token rotates
 * every time the user re-verifies.
 */
import crypto from 'crypto'
import { redis } from './redis'

export const DONOR_COOKIE_NAME = 'jsperf_donor'
export const DONOR_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

const TOKEN_RE = /^[0-9a-f]{32,128}$/i
const SESSION_KEY = (token) => `donor:session:${token}`

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

export async function createDonorSession(match, ttlSeconds = DONOR_SESSION_TTL_SECONDS) {
  const token = generateToken()
  const session = {
    name: match.name,
    source: match.source,
    amount: match.amount || 0,
    currency: match.currency || 'UAH',
    tierName: match.tierName || null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
  await redis.set(SESSION_KEY(token), JSON.stringify(session), { ex: ttlSeconds })
  return { token, session, ttl: ttlSeconds }
}

export async function getDonorSession(token) {
  if (!token || !TOKEN_RE.test(token)) return null
  const raw = await redis.get(SESSION_KEY(token))
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

export async function deleteDonorSession(token) {
  if (!token || !TOKEN_RE.test(token)) return
  await redis.del(SESSION_KEY(token))
}

export function readDonorTokenFromReq(req) {
  const cookieHeader = req?.headers?.cookie
  if (!cookieHeader) return null
  const prefix = `${DONOR_COOKIE_NAME}=`
  for (const part of cookieHeader.split(/;\s*/)) {
    if (part.startsWith(prefix)) {
      const value = decodeURIComponent(part.slice(prefix.length))
      return value || null
    }
  }
  return null
}

function buildCookie(value, maxAge) {
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `${DONOR_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (isProd) parts.push('Secure')
  return parts.join('; ')
}

export function setDonorCookie(res, token, ttlSeconds = DONOR_SESSION_TTL_SECONDS) {
  res.setHeader('Set-Cookie', buildCookie(token, ttlSeconds))
}

export function clearDonorCookie(res) {
  res.setHeader('Set-Cookie', buildCookie('', 0))
}

/**
 * Look up a donor by email, with a Redis cache. Used by
 * `getDonorFromRequest` so that GitHub-signed-in users whose primary
 * email is on the Donatello subscriber/donor list are auto-boosted —
 * no manual claim flow needed.
 *
 * Cache layout:
 *   donor:email:<lowercase email>     JSON donor session   (24h TTL)
 *   donor:email:<lowercase email>:nx  string "1" miss flag (10m TTL)
 *
 * The negative cache stops us from calling the upstream Donatello API
 * on every request from a non-donor signed-in user (the upstream API
 * is itself rate-limited at ~15 req/min per token).
 */
const EMAIL_HIT_TTL_SECONDS = 60 * 60 * 24 // 24h
const EMAIL_MISS_TTL_SECONDS = 10 * 60     // 10m
const EMAIL_KEY = (email) => `donor:email:${email.toLowerCase()}`
const EMAIL_MISS_KEY = (email) => `donor:email:${email.toLowerCase()}:nx`

export async function getDonorByEmail(email, lookupFn) {
  if (!email || typeof email !== 'string') return null
  const key = EMAIL_KEY(email)

  const cached = await redis.get(key)
  if (cached) {
    if (typeof cached === 'object') return cached
    try { return JSON.parse(cached) } catch (_) { /* fall through */ }
  }

  const miss = await redis.get(EMAIL_MISS_KEY(email))
  if (miss) return null

  if (typeof lookupFn !== 'function') return null

  let match = null
  try {
    match = await lookupFn(email)
  } catch (err) {
    console.warn('Donor email lookup failed for', email, err?.message || err)
    return null
  }

  if (!match) {
    await redis.set(EMAIL_MISS_KEY(email), '1', { ex: EMAIL_MISS_TTL_SECONDS })
    return null
  }

  const session = {
    name: match.name,
    source: match.source,
    amount: match.amount || 0,
    currency: match.currency || 'UAH',
    tierName: match.tierName || null,
    email: match.email || email.toLowerCase(),
    createdAt: match.createdAt || new Date().toISOString(),
    via: 'email',
  }
  await redis.set(key, JSON.stringify(session), { ex: EMAIL_HIT_TTL_SECONDS })
  return session
}

/** Force-refresh / clear the cached donor lookup for an email. */
export async function invalidateDonorEmailCache(email) {
  if (!email) return
  await Promise.all([
    redis.del(EMAIL_KEY(email)),
    redis.del(EMAIL_MISS_KEY(email)),
  ])
}

/**
 * Resolve the donor for an incoming API request:
 *   1. Explicit donor cookie (verified via /api/donor/verify), OR
 *   2. NextAuth session email matched against Donatello.
 *
 * `emailLookupFn` is injected to avoid a static import cycle between
 * `lib/donorAuth.js` and `lib/donatello.js`. Callers (rate limiter,
 * `/api/donor/me`) pass `findDonorByEmail` from `lib/donatello.js`.
 */
export async function getDonorFromRequest(req, { emailLookupFn, sessionEmail } = {}) {
  const token = readDonorTokenFromReq(req)
  if (token) {
    const session = await getDonorSession(token)
    if (session) return session
  }

  if (sessionEmail) {
    return getDonorByEmail(sessionEmail, emailLookupFn)
  }

  return null
}
