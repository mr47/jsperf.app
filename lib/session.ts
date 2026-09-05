/**
 * Read the NextAuth JWT from an incoming request and normalise the
 * identity fields we care about server-side.
 *
 * Every API route used to carry its own `readSessionEmail` copy; this
 * is the single place that knows the token shape (`token.user` is the
 * NextAuth `user` object, with the raw GitHub profile attached as
 * `user.profile` by the sign-in callback).
 *
 * Never throws — an unreadable/missing token is simply an anonymous
 * request.
 */
import type { IncomingMessage } from 'http'
import { getToken } from 'next-auth/jwt'

export type SessionUser = {
  /** GitHub numeric id as a string (NextAuth `user.id`). */
  id: string | null
  email: string | null
  emails: string[]
  name: string | null
  /** GitHub login (username). */
  login: string | null
  image: string | null
  isAdmin: boolean
}

type RequestLike = IncomingMessage & { cookies?: Partial<Record<string, string>> }

export function normalizeSessionToken(token: unknown): SessionUser | null {
  if (!token || typeof token !== 'object') return null
  const t = token as Record<string, any>
  const user = (t.user && typeof t.user === 'object' ? t.user : {}) as Record<string, any>
  const profile = (user.profile && typeof user.profile === 'object' ? user.profile : {}) as Record<string, any>

  const id = user.id ?? t.sub ?? null
  const email = user.email ?? t.email ?? null
  const emails = Array.isArray(user.emails) ? user.emails.filter((e: unknown) => typeof e === 'string') : []

  if (!id && !email) return null

  return {
    id: id != null ? String(id) : null,
    email: typeof email === 'string' ? email : null,
    emails,
    name: typeof user.name === 'string' ? user.name : (typeof t.name === 'string' ? t.name : null),
    login: typeof profile.login === 'string' ? profile.login : null,
    image: typeof user.image === 'string' ? user.image : (typeof profile.avatar_url === 'string' ? profile.avatar_url : null),
    isAdmin: t.isAdmin === true,
  }
}

export async function readSessionUser(req: RequestLike | undefined | null): Promise<SessionUser | null> {
  if (!req || !process.env.NEXTAUTH_SECRET) return null
  try {
    const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET })
    return normalizeSessionToken(token)
  } catch (_) {
    return null
  }
}

export async function readSessionEmail(req: RequestLike | undefined | null): Promise<string | null> {
  const user = await readSessionUser(req)
  return user?.email || null
}
