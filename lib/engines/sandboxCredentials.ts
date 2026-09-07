/**
 * Resolve Vercel Sandbox credentials before touching the SDK.
 *
 * `Sandbox.create()` resolves credentials on its own when none are passed,
 * and when that fails in a local TTY (no or expired OIDC token, CLI logged
 * out) it starts an interactive device-authorization flow that blocks the
 * API route for up to five minutes. Deep Analysis must never hang on that,
 * so we resolve credentials here and always hand them to the SDK
 * explicitly. When nothing usable is configured the V8 engine is skipped
 * with an actionable reason instead.
 *
 * Supported sources, mirroring
 * https://vercel.com/docs/sandbox/concepts/authentication:
 *
 *   1. Access token: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID
 *      (external CI / non-Vercel hosting).
 *   2. OIDC token: VERCEL_OIDC_TOKEN. Automatic on Vercel deployments.
 *      Locally it comes from `vercel link` + `vercel env pull .env.local`
 *      and expires after 12 hours; a logged-in Vercel CLI can refresh it.
 */

import { getVercelOidcToken } from '@vercel/oidc'

export interface SandboxCredentials {
  token: string
  teamId: string
  projectId: string
}

export type SandboxCredentialSource = 'access-token' | 'oidc'

export type SandboxCredentialFailureCode = 'missing' | 'incomplete' | 'expired' | 'invalid'

export type SandboxCredentialResult =
  | { ok: true; source: SandboxCredentialSource; credentials: SandboxCredentials }
  | { ok: false; code: SandboxCredentialFailureCode; reason: string }

interface JwtPayload {
  exp?: number
  owner_id?: string
  project_id?: string
}

// Refuse tokens that are about to expire so a sandbox that boots slowly does
// not lose its credentials mid-run.
const OIDC_EXPIRY_BUFFER_MS = 60_000
// The CLI-backed refresh performs a network call; bound it so a stuck
// request can never eat the analysis deadline.
const OIDC_REFRESH_TIMEOUT_MS = 10_000

export const SANDBOX_SETUP_HINT =
  'Run `npx vercel link` and `npx vercel env pull .env.local` (the OIDC token expires after 12 hours), ' +
  'or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.'

export async function resolveSandboxCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SandboxCredentialResult> {
  if (env.VERCEL_TOKEN) return fromAccessToken(env)
  return fromOidcToken(env)
}

function fromAccessToken(env: NodeJS.ProcessEnv): SandboxCredentialResult {
  const token = env.VERCEL_TOKEN as string
  // Personal access tokens are opaque; an OIDC token pasted into VERCEL_TOKEN
  // still carries its scope in the JWT payload.
  const payload = decodeJwtPayload(token)
  if (isExpired(payload)) {
    return {
      ok: false,
      code: 'expired',
      reason: `VERCEL_TOKEN holds an expired token. ${SANDBOX_SETUP_HINT}`,
    }
  }

  const teamId = env.VERCEL_TEAM_ID || payload.owner_id
  const projectId = env.VERCEL_PROJECT_ID || payload.project_id
  const missing = [!teamId && 'VERCEL_TEAM_ID', !projectId && 'VERCEL_PROJECT_ID'].filter(Boolean)
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'incomplete',
      reason:
        `VERCEL_TOKEN is set but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. ` +
        'Vercel Sandbox needs the token, team id and project id together.',
    }
  }

  return {
    ok: true,
    source: 'access-token',
    credentials: { token, teamId: teamId as string, projectId: projectId as string },
  }
}

async function fromOidcToken(env: NodeJS.ProcessEnv): Promise<SandboxCredentialResult> {
  const envToken = env.VERCEL_OIDC_TOKEN
  let token = envToken

  if (!token || isExpired(decodeJwtPayload(token))) {
    // `getVercelOidcToken` refreshes through the logged-in Vercel CLI and the
    // linked `.vercel/project.json`. It throws (never prompts) when that is
    // not possible, which is exactly the "reject" path we want.
    try {
      token = await withTimeout(
        getVercelOidcToken({
          team: env.VERCEL_TEAM_ID,
          project: env.VERCEL_PROJECT_ID,
          expirationBufferMs: OIDC_EXPIRY_BUFFER_MS,
        }),
        OIDC_REFRESH_TIMEOUT_MS,
        'Timed out refreshing the Vercel OIDC token',
      )
    } catch (error) {
      const detail = describeError(error)
      if (envToken) {
        return {
          ok: false,
          code: 'expired',
          reason: `VERCEL_OIDC_TOKEN has expired and could not be refreshed${detail}. ${SANDBOX_SETUP_HINT}`,
        }
      }
      return {
        ok: false,
        code: 'missing',
        reason: `Vercel Sandbox credentials are not configured${detail}. ${SANDBOX_SETUP_HINT}`,
      }
    }
  }

  const payload = decodeJwtPayload(token)
  const teamId = env.VERCEL_TEAM_ID || payload.owner_id
  const projectId = env.VERCEL_PROJECT_ID || payload.project_id
  if (!teamId || !projectId) {
    return {
      ok: false,
      code: 'invalid',
      reason:
        'VERCEL_OIDC_TOKEN does not carry a team and project scope. ' +
        'Re-run `npx vercel env pull .env.local` or set VERCEL_TEAM_ID and VERCEL_PROJECT_ID.',
    }
  }

  return { ok: true, source: 'oidc', credentials: { token, teamId, projectId } }
}

export function decodeJwtPayload(token: string | undefined): JwtPayload {
  if (!token) return {}
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return {}

  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    return {
      exp: typeof record.exp === 'number' ? record.exp : undefined,
      owner_id: typeof record.owner_id === 'string' ? record.owner_id : undefined,
      project_id: typeof record.project_id === 'string' ? record.project_id : undefined,
    }
  } catch {
    return {}
  }
}

function isExpired(payload: JwtPayload, bufferMs = OIDC_EXPIRY_BUFFER_MS): boolean {
  if (typeof payload.exp !== 'number') return false
  return payload.exp * 1000 <= Date.now() + bufferMs
}

function describeError(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return ''
  // The SDK's multi-line guidance duplicates SANDBOX_SETUP_HINT (and may start
  // with an empty line); keep the first meaningful line so the reason stays a
  // single readable sentence.
  const firstLine = error.message
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/[.:]+$/, '')
  return firstLine ? ` (${firstLine})` : ''
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}
