// @ts-nocheck
/**
 * GET    /api/reports/[id] — fetch a report (public; the link itself is
 *                            the bearer token).
 * DELETE /api/reports/[id] — delete a report. Only the donor who
 *                            created it can delete.
 *
 * `views` is bumped on GET in a fire-and-forget way so we can show
 * "viewed N times" on the donor's report list later.
 */
import { getDonorFromRequest } from '../../../lib/donorAuth'
import { findDonorByEmail } from '../../../lib/donatello'
import { readSessionUser } from '../../../lib/session'
import { logServerError } from '../../../lib/errorLog'
import {
  getReportById,
  bumpReportViews,
  deleteReport,
} from '../../../lib/reports'

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
      void logServerError('reports.get', err, { req })
      return res.status(500).json({ error: 'Failed to load report' })
    }
  }

  if (req.method === 'DELETE') {
    try {
      const sessionUser = await readSessionUser(req)
      const donor = await getDonorFromRequest(req, {
        emailLookupFn: findDonorByEmail,
        sessionEmail: sessionUser?.email || null,
        sessionUserId: sessionUser?.id || null,
      })
      if (!donor) return res.status(401).json({ error: 'Donor required' })
      const ok = await deleteReport({ id, donorName: donor.name })
      if (!ok) return res.status(404).json({ error: 'Report not found' })
      return res.status(200).json({ success: true })
    } catch (err) {
      void logServerError('reports.delete', err, { req })
      return res.status(500).json({ error: 'Failed to delete report' })
    }
  }

  res.setHeader('Allow', ['GET', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
