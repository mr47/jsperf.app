/**
 * POST /api/donor/promo
 *
 * Body: { code: string }
 *
 * Redeems a configured promo code for the signed-in GitHub user, then
 * mints the same donor session cookie used by paid donor verification.
 */
import { getToken } from 'next-auth/jwt'
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '../../../lib/redis'
import { createDonorSession, setDonorCookie } from '../../../lib/donorAuth'
import { getClientIp } from '../../../lib/rateLimit'
import { claimPromoCode } from '../../../lib/promoCodes'

const promoRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: true,
  prefix: 'rl:donor-promo',
})

function parseBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch (_) { return {} }
  }
  return req.body
}

async function readSessionUser(req) {
  if (!process.env.NEXTAUTH_SECRET) return null
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    const user = (token?.user || {}) as { email?: string; name?: string }
    return {
      email: user.email || token?.email || null,
      name: user.name || token?.name || null,
    }
  } catch (_) {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const ip = getClientIp(req)
    const { success: rlOk } = await promoRatelimit.limit(`promo:${ip}`)
    if (!rlOk) {
      return res.status(429).json({
        success: false,
        error: 'Too many promo attempts. Please wait a minute and try again.',
      })
    }

    const { code } = parseBody(req)
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, error: 'Promo code is required.' })
    }

    if (code.length > 100) {
      return res.status(400).json({ success: false, error: 'Promo code is too long.' })
    }

    const user = await readSessionUser(req)
    if (!user?.email) {
      return res.status(401).json({
        success: false,
        error: 'Sign in with GitHub before redeeming a promo code.',
      })
    }

    const claim = await claimPromoCode({
      code,
      email: user.email,
      name: user.name,
    })

    if (!claim.ok) {
      const failedClaim = claim as { status?: number; error?: string }
      return res.status(failedClaim.status || 400).json({
        success: false,
        error: failedClaim.error || 'Could not redeem promo code.',
      })
    }

    const { token, session, ttl } = await createDonorSession(claim.match, claim.ttlSeconds)
    setDonorCookie(res, token, ttl)

    return res.status(200).json({
      success: true,
      donor: session,
      ttl,
      alreadyRedeemed: !!claim.alreadyRedeemed,
    })
  } catch (error) {
    console.error('Donor promo error:', error)
    return res.status(500).json({
      success: false,
      error: 'Promo redemption failed. Please try again later.',
    })
  }
}
