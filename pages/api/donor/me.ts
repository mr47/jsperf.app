// @ts-nocheck
/**
 * GET    /api/donor/me   — return the active donor session (or null)
 * DELETE /api/donor/me   — clear the donor cookie + delete the session
 *
 * The frontend uses GET on mount to know whether to show the "Boosted"
 * badge, and DELETE for an explicit "sign out of donor mode" action.
 */
import {
  clearDonorCookie,
  deleteDonorSession,
  getDonorFromRequest,
  readDonorTokenFromReq,
} from '../../../lib/donorAuth'
import { findDonorByEmail } from '../../../lib/donatello'
import { readSessionUser } from '../../../lib/session'
import { logServerError } from '../../../lib/errorLog'

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    const token = readDonorTokenFromReq(req)
    if (token) {
      try { await deleteDonorSession(token) } catch (_) { /* non-fatal */ }
    }
    clearDonorCookie(res)
    return res.status(200).json({ success: true })
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'DELETE'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const sessionUser = await readSessionUser(req)
    const donor = await getDonorFromRequest(req, {
      emailLookupFn: findDonorByEmail,
      sessionEmail: sessionUser?.email || null,
      sessionUserId: sessionUser?.id || null,
    })
    return res.status(200).json({ donor: donor || null })
  } catch (error) {
    void logServerError('donor.me', error, { req })
    return res.status(200).json({ donor: null })
  }
}
