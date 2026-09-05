/**
 * GET   /api/admin/users/[id]           — directory entry + benchmarks + audit trail
 * PATCH /api/admin/users/[id]  { role }  — 'admin' | null
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { isEnvAdmin, parseJsonBody, requireAdmin, toActor } from '../../../../../lib/admin'
import { findUserByGithubId, listAudit, listUserBenchmarks, normalizeGithubId, setUserRole } from '../../../../../lib/users'
import { logServerError } from '../../../../../lib/errorLog'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const id = normalizeGithubId(req.query.id)
  if (!id) return res.status(400).json({ error: 'Invalid user id' })

  if (req.method === 'GET') {
    try {
      const [user, benchmarks, audit] = await Promise.all([
        findUserByGithubId(id),
        listUserBenchmarks(id, 50),
        listAudit({ targetType: 'user', targetId: id, limit: 50 }),
      ])
      if (!user && benchmarks.length === 0) return res.status(404).json({ error: 'User not found' })
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({
        user: user ? { ...user, _id: undefined, isEnvAdmin: isEnvAdmin({ id: user.githubId, login: user.login }) } : null,
        benchmarks,
        audit,
      })
    } catch (error) {
      void logServerError('admin.users.detail', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: 'Failed to load user' })
    }
  }

  if (req.method === 'PATCH') {
    const body = parseJsonBody<{ role?: unknown }>(req)
    const role = body.role === 'admin' ? 'admin' : body.role === null ? null : undefined
    if (role === undefined) return res.status(400).json({ error: 'role must be "admin" or null' })
    if (id === admin.id && role === null) return res.status(400).json({ error: 'You cannot remove your own admin role' })
    try {
      const target = await findUserByGithubId(id)
      if (!target) return res.status(404).json({ error: 'User must sign in once before roles can be changed' })
      await setUserRole(id, role, toActor(admin))
      return res.status(200).json({ success: true, role })
    } catch (error) {
      void logServerError('admin.users.role', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: 'Failed to update role' })
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
