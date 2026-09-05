/**
 * GET    /api/admin/errors?scope=&source=&status=open|resolved|all&q=&page=&pageSize=
 * PATCH  /api/admin/errors  { ids: string[], resolved: boolean }
 * DELETE /api/admin/errors?ids=a,b,c  |  ?resolvedOnly=1
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { parseJsonBody, requireAdmin, toActor } from '../../../lib/admin'
import { deleteErrors, listErrors, logServerError, resolveErrors } from '../../../lib/errorLog'
import { writeAudit } from '../../../lib/users'

function idList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 500)
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 500)
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  try {
    if (req.method === 'GET') {
      const status = ['open', 'resolved', 'all'].includes(String(req.query.status)) ? String(req.query.status) as 'open' | 'resolved' | 'all' : 'open'
      const source = req.query.source === 'client' || req.query.source === 'server' ? req.query.source : undefined
      const result = await listErrors({
        scope: typeof req.query.scope === 'string' && req.query.scope ? req.query.scope.slice(0, 100) : undefined,
        source,
        status,
        q: typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '',
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 50,
      })
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json(result)
    }

    if (req.method === 'PATCH') {
      const body = parseJsonBody<{ ids?: unknown; resolved?: unknown }>(req)
      const ids = idList(body.ids)
      if (!ids.length) return res.status(400).json({ error: 'ids is required' })
      const modified = await resolveErrors(ids, body.resolved !== false)
      await writeAudit({ action: body.resolved !== false ? 'errors.resolve' : 'errors.reopen', actor: toActor(admin), targetType: 'error', targetId: ids.join(','), details: { modified } })
      return res.status(200).json({ success: true, modified })
    }

    if (req.method === 'DELETE') {
      const resolvedOnly = req.query.resolvedOnly === '1'
      const ids = idList(req.query.ids)
      if (!resolvedOnly && !ids.length) return res.status(400).json({ error: 'ids or resolvedOnly=1 is required' })
      const deleted = await deleteErrors({ ids, resolvedOnly })
      await writeAudit({ action: 'errors.delete', actor: toActor(admin), targetType: 'error', targetId: resolvedOnly ? 'resolved' : ids.join(','), details: { deleted } })
      return res.status(200).json({ success: true, deleted })
    }
  } catch (error) {
    void logServerError('admin.errors', error, { req, userId: admin.id })
    return res.status(500).json({ error: 'Request failed' })
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
