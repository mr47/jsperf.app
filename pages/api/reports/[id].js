/**
 * GET    /api/reports/[id] — fetch a report (public; the link itself is
 *                            the bearer token).
 * DELETE /api/reports/[id] — delete a report. Only the donor who
 *                            created it can delete.
 *
 * `views` is bumped on GET in a fire-and-forget way so we can show
 * "viewed N times" on the donor's report list later.
 */
import { getToken } from 'next-auth/jwt'
import { getDonorFromRequest } from '../../../lib/donorAuth'
import { findDonorByEmail } from '../../../lib/donatello'
import {
  getReportById,
  bumpReportViews,
  deleteReport,
} from '../../../lib/reports'

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
  const { id } = req.query

  if (req.method === 'GET') {
    try {
      const report = await getReportById(id)
      if (!report) return res.status(404).json({ error: 'Report not found' })
      // Best-effort, never block the response.
      bumpReportViews(id).catch(() => {})
      // Strip Mongo internals from the wire response.
      const { _id, ...safe } = report
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json(safe)
    } catch (err) {
      console.error('reports: get failed', err)
      return res.status(500).json({ error: 'Failed to load report' })
    }
  }

  if (req.method === 'DELETE') {
    try {
      const sessionEmail = await readSessionEmail(req)
      const donor = await getDonorFromRequest(req, {
        emailLookupFn: findDonorByEmail,
        sessionEmail,
      })
      if (!donor) return res.status(401).json({ error: 'Donor required' })
      const ok = await deleteReport({ id, donorName: donor.name })
      if (!ok) return res.status(404).json({ error: 'Report not found' })
      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('reports: delete failed', err)
      return res.status(500).json({ error: 'Failed to delete report' })
    }
  }

  res.setHeader('Allow', ['GET', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
