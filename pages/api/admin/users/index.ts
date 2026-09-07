/**
 * GET  /api/admin/users?q=&filter=all|banned|premium|admins&page=&pageSize=
 * POST /api/admin/users   { action: 'backfill' }  — seed directory from pages.githubID
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { parseJsonBody, requireAdmin, toActor } from '../../../../lib/admin'
import { backfillUsersFromPages, listUsers, writeAudit, type UserListFilter } from '../../../../lib/users'
import { logServerError } from '../../../../lib/errorLog'

const FILTERS: UserListFilter[] = ['all', 'banned', 'premium', 'admins']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  if (req.method === 'GET') {
    try {
      const filterParam = typeof req.query.filter === 'string' ? req.query.filter : 'all'
      const filter = (FILTERS.includes(filterParam as UserListFilter) ? filterParam : 'all') as UserListFilter
      const result = await listUsers({
        q: typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '',
        filter,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 25,
      })
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json(result)
    } catch (error) {
      void logServerError('admin.users.list', error, { req, userId: admin.id })
      return res.status(500).json({ error: 'Failed to list users' })
    }
  }

  if (req.method === 'POST') {
    const body = parseJsonBody<{ action?: string }>(req)
    if (body.action !== 'backfill') return res.status(400).json({ error: 'Unknown action' })
    try {
      const result = await backfillUsersFromPages()
      await writeAudit({ action: 'users.backfill', actor: toActor(admin), targetType: 'system', targetId: 'users', details: result })
      return res.status(200).json({ success: true, ...result })
    } catch (error) {
      void logServerError('admin.users.backfill', error, { req, userId: admin.id })
      return res.status(500).json({ error: 'Backfill failed' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
