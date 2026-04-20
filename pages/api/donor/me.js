/**
 * GET    /api/donor/me   — return the active donor session (or null)
 * DELETE /api/donor/me   — clear the donor cookie + delete the session
 *
 * The frontend uses GET on mount to know whether to show the "Boosted"
 * badge, and DELETE for an explicit "sign out of donor mode" action.
 */
import { getToken } from 'next-auth/jwt'
import {
  clearDonorCookie,
  deleteDonorSession,
  getDonorFromRequest,
  readDonorTokenFromReq,
} from '../../../lib/donorAuth'
import { findDonorByEmail } from '../../../lib/donatello'

async function readSessionEmail(req) {
  if (!process.env.NEXTAUTH_SECRET) return null
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    return token?.user?.email || token?.email || null
  } catch (_) {
    return null
  }
}

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
    const sessionEmail = await readSessionEmail(req)
    const donor = await getDonorFromRequest(req, {
      emailLookupFn: findDonorByEmail,
      sessionEmail,
    })
    return res.status(200).json({ donor: donor || null })
  } catch (error) {
    console.error('Donor me error:', error)
    return res.status(200).json({ donor: null })
  }
}
