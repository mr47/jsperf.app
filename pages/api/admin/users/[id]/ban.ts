/**
 * POST   /api/admin/users/[id]/ban  { reason, days?, hideContent? }
 * DELETE /api/admin/users/[id]/ban
 *
 * Bans take effect immediately for write APIs (Redis mirror) and block
 * future sign-ins. Existing JWT sessions are not revoked, but every
 * protected endpoint re-checks the ban. When `hideContent` is set the
 * user's benchmarks are unpublished and their ISR pages revalidated.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { parseJsonBody, requireAdmin, toActor } from '../../../../../lib/admin'
import { banUser, normalizeGithubId, unbanUser } from '../../../../../lib/users'
import { logServerError } from '../../../../../lib/errorLog'

const MAX_REVALIDATE = 100

async function revalidatePaths(res: NextApiResponse, paths: string[]) {
  const unique = Array.from(new Set(paths)).slice(0, MAX_REVALIDATE)
  const results = await Promise.allSettled(unique.map((p) => res.revalidate(p)))
  return results.filter((r) => r.status === 'fulfilled').length
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const id = normalizeGithubId(req.query.id)
  if (!id) return res.status(400).json({ error: 'Invalid user id' })
  if (id === admin.id) return res.status(400).json({ error: 'You cannot ban yourself' })

  if (req.method === 'POST') {
    const body = parseJsonBody<{ reason?: string; days?: number; hideContent?: boolean }>(req)
    if (!body.reason || typeof body.reason !== 'string' || !body.reason.trim()) {
      return res.status(400).json({ error: 'A reason is required' })
    }
    try {
      const { ban, affectedPaths } = await banUser(id, {
        reason: body.reason,
        days: Number(body.days) || 0,
        hideContent: body.hideContent === true,
      }, toActor(admin))
      const revalidated = affectedPaths.length ? await revalidatePaths(res, affectedPaths) : 0
      return res.status(200).json({ success: true, ban, hiddenPages: affectedPaths.length, revalidated })
    } catch (error) {
      void logServerError('admin.users.ban', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: (error as Error)?.message || 'Failed to ban user' })
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { restoredPages, affectedPaths } = await unbanUser(id, toActor(admin))
      const revalidated = affectedPaths.length ? await revalidatePaths(res, affectedPaths) : 0
      return res.status(200).json({ success: true, restoredPages, revalidated })
    } catch (error) {
      void logServerError('admin.users.unban', error, { req, userId: admin.id, targetId: id })
      return res.status(500).json({ error: (error as Error)?.message || 'Failed to unban user' })
    }
  }

  res.setHeader('Allow', ['POST', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
