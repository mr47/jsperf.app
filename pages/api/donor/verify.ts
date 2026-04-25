// @ts-nocheck
/**
 * POST /api/donor/verify
 *
 * Body: { name: string, code?: string }
 *
 * Looks the user up via the Donatello API. On a hit, mints a session
 * token, stores it in Redis, and sets the donor cookie. From then on
 * the user's API requests are billed against the higher donor rate-
 * limit tier (see lib/rateLimit.js).
 */
import { findDonorMatch } from '../../../lib/donatello'
import { createDonorSession, setDonorCookie } from '../../../lib/donorAuth'
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '../../../lib/redis'
import { getClientIp } from '../../../lib/rateLimit'

// Donatello rate-limits the API at ~15 req/min per token; we cap the
// public verify endpoint well below that so a single buggy/malicious
// caller can't lock us out of the upstream API.
const verifyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  analytics: true,
  prefix: 'rl:donor-verify',
})

function parseBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch (_) { return {} }
  }
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const ip = getClientIp(req)
    const { success: rlOk } = await verifyRatelimit.limit(`verify:${ip}`)
    if (!rlOk) {
      return res.status(429).json({
        success: false,
        error: 'Too many verification attempts. Please wait a minute and try again.',
      })
    }

    const { name, code } = parseBody(req)

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Donor name is required.' })
    }

    if (name.length > 100 || (code && String(code).length > 100)) {
      return res.status(400).json({ success: false, error: 'Inputs are too long.' })
    }

    if (!process.env.DONATELLO_TOKEN) {
      return res.status(503).json({ success: false, error: 'Donor verification is not configured on this server.' })
    }

    const trimmedName = name.trim()
    const trimmedCode = code ? String(code).trim() : undefined

    console.info(
      `[donor-verify] looking up name=${JSON.stringify(trimmedName)}` +
      (trimmedCode ? ` code=${JSON.stringify(trimmedCode)}` : '')
    )

    const match = await findDonorMatch({ name: trimmedName, code: trimmedCode })

    if (!match) {
      return res.status(404).json({
        success: false,
        error: trimmedCode
          ? `No donation found for "${trimmedName}" with code "${trimmedCode}". The code must appear inside the donation message exactly as you typed it. New donations can take a minute to appear in the API.`
          : `No donation found for "${trimmedName}". The name must match the one shown on Donatello (case is ignored, but extra spaces matter). If you donated within the last minute, try again shortly.`,
      })
    }

    const { token, session, ttl } = await createDonorSession(match)
    setDonorCookie(res, token, ttl)

    return res.status(200).json({
      success: true,
      donor: session,
      ttl,
    })
  } catch (error) {
    console.error('Donor verify error:', error)
    return res.status(500).json({
      success: false,
      error: 'Donor verification failed. Please try again later.',
    })
  }
}
