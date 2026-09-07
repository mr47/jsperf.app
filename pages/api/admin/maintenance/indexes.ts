/**
 * GET  /api/admin/maintenance/indexes — recommended index status
 * POST /api/admin/maintenance/indexes — create the missing ones (background build)
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin, toActor } from '../../../../lib/admin'
import { checkRecommendedIndexes, createRecommendedIndexes } from '../../../../lib/adminStats'
import { logServerError } from '../../../../lib/errorLog'
import { writeAudit } from '../../../../lib/users'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({ indexes: await checkRecommendedIndexes() })
    }
    if (req.method === 'POST') {
      const results = await createRecommendedIndexes()
      await writeAudit({ action: 'maintenance.indexes', actor: toActor(admin), targetType: 'system', targetId: 'indexes', details: { created: results.filter((r) => r.created).map((r) => `${r.collection}.${r.name}`) } })
      return res.status(200).json({ success: true, results })
    }
  } catch (error) {
    void logServerError('admin.maintenance.indexes', error, { req, userId: admin.id })
    return res.status(500).json({ error: (error as Error)?.message || 'Request failed' })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
