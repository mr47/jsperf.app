/**
 * Admin authorisation.
 *
 * Two sources of truth, OR-ed together:
 *   1. Env allowlist — `ADMIN_GITHUB_IDS` (numeric GitHub ids) and/or
 *      `ADMIN_GITHUB_LOGINS` (usernames), comma-separated. This is the
 *      bootstrap path: set it once so the first admin can reach the panel.
 *   2. `users.role === 'admin'` in MongoDB — promoted from the panel.
 *
 * API routes call `requireAdmin(req, res)`; SSR pages call
 * `requireAdminSsr(ctx)`. Both re-check authorisation on every request
 * (the `isAdmin` flag baked into the JWT is only a UI hint for the header).
 */
import type { GetServerSidePropsContext, NextApiRequest, NextApiResponse } from 'next'
import { readSessionUser, type SessionUser } from './session'
import { findUserByGithubId, type AdminActor } from './users'

function parseList(value: string | undefined): Set<string> {
  return new Set(
    String(value || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isEnvAdmin({ id, login }: { id?: string | null; login?: string | null }): boolean {
  const ids = parseList(process.env.ADMIN_GITHUB_IDS)
  const logins = parseList(process.env.ADMIN_GITHUB_LOGINS)
  if (id && ids.has(String(id).toLowerCase())) return true
  if (login && logins.has(login.toLowerCase())) return true
  return false
}

export function hasAnyEnvAdmin(): boolean {
  return parseList(process.env.ADMIN_GITHUB_IDS).size > 0 || parseList(process.env.ADMIN_GITHUB_LOGINS).size > 0
}

/**
 * Authoritative check. Env allowlist first (no I/O), then the directory.
 * Database failures are treated as "not admin".
 */
export async function isAdminUser(user: { id?: string | null; login?: string | null } | null | undefined): Promise<boolean> {
  if (!user) return false
  if (isEnvAdmin(user)) return true
  if (!user.id) return false
  try {
    const doc = await findUserByGithubId(user.id)
    return doc?.role === 'admin'
  } catch (err) {
    console.warn('[admin] role lookup failed', (err as Error)?.message || err)
    return false
  }
}

export type AdminSession = SessionUser & { id: string }

export async function getAdminFromRequest(req: NextApiRequest | GetServerSidePropsContext['req']): Promise<AdminSession | null> {
  const user = await readSessionUser(req)
  if (!user?.id) return null
  if (!(await isAdminUser(user))) return null
  return user as AdminSession
}

export function toActor(admin: AdminSession): AdminActor {
  return { id: admin.id, login: admin.login }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * API guard. Responds 401/403 and returns null when the caller is not an
 * admin. Mutations additionally require a same-origin fetch (the NextAuth
 * cookie is SameSite=Lax, but `Sec-Fetch-Site` gives us defence in depth
 * against a stray cross-site POST) and a JSON body content type.
 */
export async function requireAdmin(req: NextApiRequest, res: NextApiResponse): Promise<AdminSession | null> {
  const user = await readSessionUser(req)
  if (!user?.id) {
    res.status(401).json({ error: 'Sign in required' })
    return null
  }
  if (!(await isAdminUser(user))) {
    res.status(403).json({ error: 'Admin access required' })
    return null
  }
  if (MUTATING_METHODS.has(req.method || '')) {
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      res.status(403).json({ error: 'Cross-site request rejected' })
      return null
    }
    const contentType = String(req.headers['content-type'] || '')
    if (req.method !== 'DELETE' && !contentType.includes('application/json')) {
      res.status(415).json({ error: 'Expected application/json' })
      return null
    }
  }
  return user as AdminSession
}

/**
 * SSR guard for `/admin/*` pages. Anonymous → sign-in redirect; signed-in
 * non-admin → 404 so the panel's existence isn't advertised.
 */
export async function requireAdminSsr(ctx: GetServerSidePropsContext): Promise<
  { admin: AdminSession } | { redirect: { destination: string; permanent: false } } | { notFound: true }
> {
  const user = await readSessionUser(ctx.req)
  if (!user?.id) {
    const callbackUrl = encodeURIComponent(ctx.resolvedUrl || '/admin')
    return { redirect: { destination: `/api/auth/signin?callbackUrl=${callbackUrl}`, permanent: false } }
  }
  if (!(await isAdminUser(user))) return { notFound: true }
  return { admin: user as AdminSession }
}

export function parseJsonBody<T = Record<string, unknown>>(req: NextApiRequest): T {
  const body = req.body
  if (!body) return {} as T
  if (typeof body === 'string') {
    try { return JSON.parse(body) as T } catch (_) { return {} as T }
  }
  return body as T
}
