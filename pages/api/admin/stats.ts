/**
 * GET /api/admin/stats[?fresh=1] — dashboard metrics (cached 60s).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin } from '../../../lib/admin'
import { getAdminStats } from '../../../lib/adminStats'
import { logServerError } from '../../../lib/errorLog'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }
  const admin = await requireAdmin(req, res)
  if (!admin) return

  try {
    const stats = await getAdminStats({ fresh: req.query.fresh === '1' })
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json(stats)
  } catch (error) {
    void logServerError('admin.stats', error, { req, userId: admin.id })
    return res.status(500).json({ error: 'Failed to compute stats' })
  }
}
