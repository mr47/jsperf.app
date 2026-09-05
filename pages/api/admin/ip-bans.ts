/**
 * GET    /api/admin/ip-bans                     — list
 * POST   /api/admin/ip-bans  { ip, reason, days? }
 * DELETE /api/admin/ip-bans?ip=1.2.3.4
 *
 * IP bans cover the anonymous write paths (benchmark create, run
 * submission, deep analysis) that don't require a GitHub session.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { parseJsonBody, requireAdmin, toActor } from '../../../lib/admin'
import { banIp, listIpBans, unbanIp } from '../../../lib/users'
import { logServerError } from '../../../lib/errorLog'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({ items: await listIpBans() })
    }

    if (req.method === 'POST') {
      const body = parseJsonBody<{ ip?: string; reason?: string; days?: number }>(req)
      if (!body.ip) return res.status(400).json({ error: 'ip is required' })
      if (!body.reason?.trim()) return res.status(400).json({ error: 'A reason is required' })
      const record = await banIp(body.ip, body.reason, Number(body.days) || null, toActor(admin))
      return res.status(200).json({ success: true, ban: record })
    }

    if (req.method === 'DELETE') {
      const ip = typeof req.query.ip === 'string' ? req.query.ip : null
      if (!ip) return res.status(400).json({ error: 'ip is required' })
      await unbanIp(ip, toActor(admin))
      return res.status(200).json({ success: true })
    }
  } catch (error) {
    const message = (error as Error)?.message || 'Request failed'
    if (/Invalid IP/i.test(message)) return res.status(400).json({ error: message })
    void logServerError('admin.ipBans', error, { req, userId: admin.id })
    return res.status(500).json({ error: message })
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
