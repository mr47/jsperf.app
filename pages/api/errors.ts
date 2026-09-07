/**
 * POST /api/errors — browser-side error reports.
 *
 * Body: { message, stack?, url?, source? }
 *
 * Reports are grouped into the same `errors` collection the admin panel
 * reads, tagged `source: 'client'`. Strictly rate-limited per IP and
 * size-capped so this can't be used to flood the log; the response is
 * always 204 so the client never retries.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '../../lib/redis'
import { getClientIp } from '../../lib/rateLimit'
import { logServerError } from '../../lib/errorLog'

const clientErrorRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  analytics: false,
  prefix: 'rl:client-errors',
})

const MAX_FIELD = 2000

function field(value: unknown, max = MAX_FIELD): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch (_) { return {} }
  }
  return typeof req.body === 'object' ? req.body : {}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const { success } = await clientErrorRatelimit.limit(`client-errors:${getClientIp(req)}`)
    if (!success) return res.status(204).end()

    const body = parseBody(req)
    const message = field(body.message, 1000)
    if (!message) return res.status(204).end()

    const stack = field(body.stack)
    const error = new Error(message)
    error.name = field(body.name, 100) || 'ClientError'
    error.stack = stack || `${error.name}: ${message}`

    await logServerError('client', error, {
      req,
      source: 'client',
      pageUrl: field(body.url, 500),
      kind: field(body.source, 50),
    })
  } catch (_) {
    // swallow: this endpoint must be fire-and-forget for the browser
  }

  return res.status(204).end()
}
