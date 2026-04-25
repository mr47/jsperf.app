// @ts-nocheck
/**
 * Tiered rate-limit helper.
 *
 * Each named limiter has two buckets sharing one window:
 *   - `free`  — keyed by client IP, the default
 *   - `donor` — keyed by donor nickname, with a higher cap
 *
 * Callers pass the limiter name and per-tier numbers; we cache the
 * Ratelimit objects so we don't recreate them on every request (each
 * one carries its own Redis pipeline state).
 *
 * Donor identity comes from the `jsperf_donor` cookie via
 * `donorAuth.getDonorFromRequest`. Donors get one bucket regardless of
 * which device or IP they're on, so a verified donor isn't punished
 * for switching networks.
 */
import { Ratelimit } from '@upstash/ratelimit'
import { getToken } from 'next-auth/jwt'
import { redis } from './redis'
import { getDonorFromRequest } from './donorAuth'
import { findDonorByEmail } from './donatello'

const limiterCache = new Map()

export function createTieredLimiter(name, { free, donor, window = '1 m' }) {
  const cacheKey = `${name}:${free}:${donor}:${window}`
  if (limiterCache.has(cacheKey)) return limiterCache.get(cacheKey)

  const limiters = {
    free: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(free, window),
      analytics: true,
      prefix: `rl:${name}`,
    }),
    donor: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(donor, window),
      analytics: true,
      prefix: `rl:${name}:donor`,
    }),
    limits: { free, donor, window },
  }
  limiterCache.set(cacheKey, limiters)
  return limiters
}

export function getClientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim()
  }
  return req?.socket?.remoteAddress || '127.0.0.1'
}

/**
 * Pull the NextAuth-signed-in user's email from the JWT cookie, if
 * any. Used to auto-match GitHub sign-ins against the Donatello
 * donor list without requiring users to run the manual claim flow.
 *
 * Returns null on any failure — sign-in is best-effort for the rate
 * limiter; missing JWT just means free tier.
 */
async function readSessionEmail(req) {
  if (!process.env.NEXTAUTH_SECRET) return null
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    return token?.user?.email || token?.email || null
  } catch (_) {
    return null
  }
}

/**
 * Check the rate limit for `req` against the named limiter. Returns
 * the upstash result (`success`, `limit`, `remaining`, `reset`) plus
 * `tier` and the resolved `donor` (when applicable).
 *
 * Intentionally never throws — donor lookup failures degrade to the
 * free tier so a Redis or upstream-API blip can't take the API
 * offline.
 */
export async function applyTieredRateLimit(req, name, limits) {
  const limiters = createTieredLimiter(name, limits)

  let donor = null
  try {
    const sessionEmail = await readSessionEmail(req)
    donor = await getDonorFromRequest(req, {
      emailLookupFn: findDonorByEmail,
      sessionEmail,
    })
  } catch (_) {
    donor = null
  }

  if (donor) {
    // Prefer email as the bucket key when matched via GitHub sign-in
    // (one bucket per identity, regardless of device); otherwise use
    // the donor nickname.
    const id = (donor.email || donor.name || '').toLowerCase()
    const key = `donor:${id}`
    const result = await limiters.donor.limit(key)
    return { ...result, tier: 'donor', donor, configuredLimit: limits.donor }
  }

  const ip = getClientIp(req)
  const result = await limiters.free.limit(ip)
  return { ...result, tier: 'free', donor: null, configuredLimit: limits.free }
}

/**
 * Set common headers describing the rate-limit decision so clients
 * (and curious developers) can see what tier they're on without
 * scraping the body.
 */
export function setRateLimitHeaders(res, result) {
  if (!res || !result) return
  try {
    res.setHeader('X-RateLimit-Tier', result.tier || 'free')
    if (result.limit != null) res.setHeader('X-RateLimit-Limit', String(result.limit))
    if (result.remaining != null) res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)))
    if (result.reset != null) res.setHeader('X-RateLimit-Reset', String(result.reset))
  } catch (_) {
    // Headers may already be sent (NDJSON streaming) — fail silently.
  }
}
