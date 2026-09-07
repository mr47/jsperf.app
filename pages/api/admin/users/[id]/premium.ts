/**
 * POST   /api/admin/users/[id]/premium  { days, tierName?, note? }
 * DELETE /api/admin/users/[id]/premium
 *
 * Grants (or revokes) the donor boost without a donation. The grant is
 * picked up by `getDonorFromRequest` for the user's GitHub id and any
 * email GitHub shared with us, so it applies to rate limits, reports,
 * and worker-side analysis exactly like a Donatello match.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { parseJsonBody, requireAdmin, toActor } from '../../../../../lib/admin'
import { grantDonor, normalizeGithubId, revokeDonorGrant } from '../../../../../lib/users'
import { logServerError } from '../../../../../lib/errorLog'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const id = normalizeGithubId(req.query.id)
  if (!id) return res.status(400).json({ error: 'Invalid user id' })

  if (req.method === 'POST') {
    const body = parseJsonBody<{ days?: number; tierName?: string; note?: string }>(req)
    const days = Math.floor(Number(body.days))
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return res.status(400).json({ error: 'days must be between 1 and 3650' })
    }
    try {
      const grant = await grantDonor(id, { days, tierName: body.tierName, note: body.note }, toActor(admin))
      return res.status(200).json({ success: true, grant })
    } catch (error) {
      const message = (error as Error)?.message || 'Failed to grant boost'
      if (/has not signed in/i.test(message)) return res.status(409).json({ error: message })
      void logServerError('admin.users.grant', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: message })
    }
  }

  if (req.method === 'DELETE') {
    try {
      await revokeDonorGrant(id, toActor(admin))
      return res.status(200).json({ success: true })
    } catch (error) {
      void logServerError('admin.users.revoke', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: (error as Error)?.message || 'Failed to revoke boost' })
    }
  }

  res.setHeader('Allow', ['POST', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
