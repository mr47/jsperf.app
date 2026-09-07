/**
 * Request-level ban enforcement for write endpoints.
 *
 * Bans are resolved from Redis only (see lib/users.ts for the mirror),
 * so the check costs a single MGET on top of the existing rate limiter.
 * Anonymous benchmark creation is allowed, so we check both the GitHub
 * id from the session and the client IP.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { getClientIp } from './rateLimit'
import { readSessionUser } from './session'
import { findActiveBan, type BanRecord } from './users'

export type ActiveBan = BanRecord & { kind: 'user' | 'ip' }

export async function getBanForRequest(
  req: NextApiRequest,
  { sessionUserId }: { sessionUserId?: string | null } = {},
): Promise<ActiveBan | null> {
  let githubId = sessionUserId ?? null
  if (githubId === undefined || githubId === null) {
    const user = await readSessionUser(req)
    githubId = user?.id ?? null
  }
  return findActiveBan({ githubId, ip: getClientIp(req) })
}

export function banResponseBody(ban: ActiveBan) {
  return {
    success: false,
    error: 'banned',
    message: ban.until
      ? `Your access to jsPerf write features is suspended until ${new Date(ban.until).toUTCString()}. Reason: ${ban.reason}`
      : `Your access to jsPerf write features has been suspended. Reason: ${ban.reason}`,
    until: ban.until,
  }
}

/**
 * Returns true (and writes a 403) when the request comes from a banned
 * user or IP. Callers should `return` immediately when it does.
 */
export async function rejectIfBanned(
  req: NextApiRequest,
  res: NextApiResponse,
  opts: { sessionUserId?: string | null } = {},
): Promise<boolean> {
  const ban = await getBanForRequest(req, opts)
  if (!ban) return false
  res.status(403).json(banResponseBody(ban))
  return true
}
