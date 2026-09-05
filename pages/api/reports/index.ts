// @ts-nocheck
/**
 * POST /api/reports — create a presentation report. Donor-only.
 * GET  /api/reports — list the current donor's reports.
 *
 * Body for POST: { slug: string, revision: number, theme?: string }
 * Returns:       { id, url }
 *
 * The endpoint is gated by donor status. Anonymous (or merely-signed-
 * in-but-not-donor) callers get a 402 with a short explanation that
 * the UI surfaces by re-opening the donor modal.
 */
import { getDonorFromRequest } from '../../../lib/donorAuth'
import { findDonorByEmail } from '../../../lib/donatello'
import { createReport, listReportsForDonor } from '../../../lib/reports'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../../lib/rateLimit'
import { readSessionUser } from '../../../lib/session'
import { rejectIfBanned } from '../../../lib/bans'
import { logServerError } from '../../../lib/errorLog'

const RATE_LIMIT = { free: 0, donor: 30, window: '1 h' }

async function resolveDonor(req, sessionUser) {
  try {
    return await getDonorFromRequest(req, {
      emailLookupFn: findDonorByEmail,
      sessionEmail: sessionUser?.email || null,
      sessionUserId: sessionUser?.id || null,
    })
  } catch (err) {
    console.warn('reports: donor resolve failed', err?.message || err)
    return null
  }
}

export default async function handler(req, res) {
  const sessionUser = await readSessionUser(req)

  if (req.method === 'GET') {
    const donor = await resolveDonor(req, sessionUser)
    if (!donor) return res.status(200).json({ reports: [] })
    try {
      const reports = await listReportsForDonor(donor.name, { limit: 30 })
      return res.status(200).json({ reports })
    } catch (err) {
      void logServerError('reports.list', err, { req })
      return res.status(500).json({ error: 'Failed to list reports' })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  if (await rejectIfBanned(req, res, { sessionUserId: sessionUser?.id || null })) return

  const donor = await resolveDonor(req, sessionUser)
  if (!donor) {
    return res.status(402).json({
      error: 'Donor required',
      message: 'Generating presentation reports is a donor perk. Support jsPerf to unlock it.',
    })
  }

  // Rate limit only after we know it's a donor — non-donors are
  // already blocked above so we don't burn IP buckets on them.
  let rl
  try {
    rl = await applyTieredRateLimit(req, 'reports', RATE_LIMIT)
    setRateLimitHeaders(res, rl)
  } catch (err) {
    console.warn('reports: rate limit failed (allowing through):', err?.message || err)
  }
  if (rl && !rl.success) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `You can generate up to ${rl.configuredLimit ?? RATE_LIMIT.donor} reports per hour.`,
    })
  }

  const { slug, revision, theme, clientAnalysis, clientMultiRuntime } = req.body || {}
  if (!slug || revision == null) {
    return res.status(400).json({ error: 'slug and revision are required' })
  }
  const safeTheme = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto'

  try {
    const { id, url } = await createReport({
      slug,
      revision,
      theme: safeTheme,
      donor,
      clientAnalysis: clientAnalysis && typeof clientAnalysis === 'object' ? clientAnalysis : null,
      clientMultiRuntime: clientMultiRuntime && typeof clientMultiRuntime === 'object' ? clientMultiRuntime : null,
    })
    return res.status(201).json({ id, url })
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message })
    if (err.code === 'RATE_LIMITED') return res.status(429).json({ error: err.message })
    void logServerError('reports.create', err, { req, userId: sessionUser?.id || null, slug, revision })
    return res.status(500).json({ error: 'Failed to create report' })
  }
}
