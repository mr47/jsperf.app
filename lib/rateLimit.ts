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
import { redis } from './redis'
import { getDonorFromRequest } from './donorAuth'
import { findDonorByEmail } from './donatello'
import { readSessionUser } from './session'

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
 * Check the rate limit for `req` against the named limiter. Returns
 * the upstash result (`success`, `limit`, `remaining`, `reset`) plus
 * `tier` and the resolved `donor` (when applicable).
 *
 * The signed-in GitHub identity (if any) is used to auto-match against
 * Donatello donors and admin grants without a manual claim flow.
 *
 * Intentionally never throws — donor lookup failures degrade to the
 * free tier, and a Redis outage degrades to a per-process in-memory
 * window (see `limitWithFallback`), so a blip can't take the API
 * offline or switch it to unlimited.
 */
export async function applyTieredRateLimit(req, name, limits) {
  const limiters = createTieredLimiter(name, limits)

  let donor = null
  try {
    const sessionUser = await readSessionUser(req)
    donor = await getDonorFromRequest(req, {
      emailLookupFn: findDonorByEmail,
      sessionEmail: sessionUser?.email || null,
      sessionUserId: sessionUser?.id || null,
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
    const result = await limitWithFallback(limiters.donor, `${name}:donor`, key, limits.donor, limits.window)
    return { ...result, tier: 'donor', donor, configuredLimit: limits.donor }
  }

  const ip = getClientIp(req)
  const result = await limitWithFallback(limiters.free, `${name}:free`, ip, limits.free, limits.window)
  return { ...result, tier: 'free', donor: null, configuredLimit: limits.free }
}

/**
 * Redis outage policy: neither fail open (unlimited writes) nor fail
 * closed (every write 500s). Fall back to a per-process fixed window with
 * the same numbers, which still bounds abuse on each instance, and mark
 * the result `degraded` so callers/headers can tell.
 */
async function limitWithFallback(limiter, bucket, id, limit, window) {
  try {
    return await limiter.limit(id)
  } catch (err) {
    console.warn(`[rateLimit] ${bucket}: redis limiter failed, using in-memory fallback: ${err?.message || err}`)
    return { ...localLimit(`${bucket}:${id}`, limit, parseWindowMs(window)), degraded: true }
  }
}

const LOCAL_BUCKET_CAP = 10_000
const localBuckets = new Map()

function localLimit(key, limit, windowMs) {
  const now = Date.now()
  let entry = localBuckets.get(key)
  if (!entry || now >= entry.resetAt) {
    if (localBuckets.size >= LOCAL_BUCKET_CAP) localBuckets.clear()
    entry = { count: 0, resetAt: now + windowMs }
    localBuckets.set(key, entry)
  }
  entry.count++
  return {
    success: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    reset: entry.resetAt,
    pending: Promise.resolve(),
  }
}

export function parseWindowMs(window) {
  const match = /^\s*(\d+)\s*(ms|s|m|h|d)\s*$/.exec(String(window || '1 m'))
  if (!match) return 60_000
  const n = Number(match[1])
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]
  return n * unit
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
    if (result.degraded) res.setHeader('X-RateLimit-Degraded', '1')
  } catch (_) {
    // Headers may already be sent (NDJSON streaming) — fail silently.
  }
}
