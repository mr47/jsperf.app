import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getVercelOidcToken = vi.fn<(...args: unknown[]) => Promise<string>>()

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: (...args: unknown[]) => getVercelOidcToken(...args),
}))

import { decodeJwtPayload, resolveSandboxCredentials } from '../../lib/engines/sandboxCredentials'

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeJwt(payload: Record<string, unknown>) {
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.sig`
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 6 * 3600
const PAST_EXP = Math.floor(Date.now() / 1000) - 60

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...overrides } as NodeJS.ProcessEnv
}

describe('resolveSandboxCredentials', () => {
  beforeEach(() => {
    getVercelOidcToken.mockReset()
    getVercelOidcToken.mockRejectedValue(new Error('Could not get credentials from OIDC context.\nlink your project'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('access token', () => {
    it('uses VERCEL_TOKEN with explicit team and project ids', async () => {
      const result = await resolveSandboxCredentials(env({
        VERCEL_TOKEN: 'vercel_pat_abc',
        VERCEL_TEAM_ID: 'team_1',
        VERCEL_PROJECT_ID: 'prj_1',
      }))

      expect(result).toEqual({
        ok: true,
        source: 'access-token',
        credentials: { token: 'vercel_pat_abc', teamId: 'team_1', projectId: 'prj_1' },
      })
      expect(getVercelOidcToken).not.toHaveBeenCalled()
    })

    it('fills scope from the JWT payload when VERCEL_TOKEN holds an OIDC token', async () => {
      const token = makeJwt({ owner_id: 'team_jwt', project_id: 'prj_jwt', exp: FUTURE_EXP })
      const result = await resolveSandboxCredentials(env({ VERCEL_TOKEN: token }))

      expect(result).toMatchObject({
        ok: true,
        credentials: { token, teamId: 'team_jwt', projectId: 'prj_jwt' },
      })
    })

    it('rejects a personal access token without team and project ids', async () => {
      const result = await resolveSandboxCredentials(env({ VERCEL_TOKEN: 'vercel_pat_abc' }))

      expect(result).toMatchObject({ ok: false, code: 'incomplete' })
      expect(result.ok === false && result.reason).toContain('VERCEL_TEAM_ID and VERCEL_PROJECT_ID')
      expect(getVercelOidcToken).not.toHaveBeenCalled()
    })

    it('names the single missing variable', async () => {
      const result = await resolveSandboxCredentials(env({
        VERCEL_TOKEN: 'vercel_pat_abc',
        VERCEL_TEAM_ID: 'team_1',
      }))

      expect(result).toMatchObject({ ok: false, code: 'incomplete' })
      expect(result.ok === false && result.reason).toMatch(/VERCEL_PROJECT_ID is missing/)
    })

    it('rejects an expired token pasted into VERCEL_TOKEN', async () => {
      const token = makeJwt({ owner_id: 'team_jwt', project_id: 'prj_jwt', exp: PAST_EXP })
      const result = await resolveSandboxCredentials(env({ VERCEL_TOKEN: token }))

      expect(result).toMatchObject({ ok: false, code: 'expired' })
    })
  })

  describe('OIDC token', () => {
    it('uses a valid VERCEL_OIDC_TOKEN without contacting the refresh flow', async () => {
      const token = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: FUTURE_EXP })
      const result = await resolveSandboxCredentials(env({ VERCEL_OIDC_TOKEN: token }))

      expect(result).toEqual({
        ok: true,
        source: 'oidc',
        credentials: { token, teamId: 'team_oidc', projectId: 'prj_oidc' },
      })
      expect(getVercelOidcToken).not.toHaveBeenCalled()
    })

    it('prefers explicit VERCEL_TEAM_ID / VERCEL_PROJECT_ID over the JWT scope', async () => {
      const token = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: FUTURE_EXP })
      const result = await resolveSandboxCredentials(env({
        VERCEL_OIDC_TOKEN: token,
        VERCEL_TEAM_ID: 'team_env',
        VERCEL_PROJECT_ID: 'prj_env',
      }))

      expect(result).toMatchObject({
        ok: true,
        credentials: { teamId: 'team_env', projectId: 'prj_env' },
      })
    })

    it('refreshes an expired token through @vercel/oidc when the CLI can', async () => {
      const stale = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: PAST_EXP })
      const fresh = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: FUTURE_EXP })
      getVercelOidcToken.mockResolvedValue(fresh)

      const result = await resolveSandboxCredentials(env({ VERCEL_OIDC_TOKEN: stale }))

      expect(getVercelOidcToken).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ ok: true, source: 'oidc', credentials: { token: fresh } })
    })

    it('treats a token expiring within the safety buffer as expired', async () => {
      const soon = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: Math.floor(Date.now() / 1000) + 10 })
      const fresh = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: FUTURE_EXP })
      getVercelOidcToken.mockResolvedValue(fresh)

      const result = await resolveSandboxCredentials(env({ VERCEL_OIDC_TOKEN: soon }))

      expect(getVercelOidcToken).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ ok: true, credentials: { token: fresh } })
    })

    it('reports an expired token that cannot be refreshed with the local setup hint', async () => {
      const stale = makeJwt({ owner_id: 'team_oidc', project_id: 'prj_oidc', exp: PAST_EXP })
      const result = await resolveSandboxCredentials(env({ VERCEL_OIDC_TOKEN: stale }))

      expect(result).toMatchObject({ ok: false, code: 'expired' })
      const reason = result.ok === false ? result.reason : ''
      expect(reason).toContain('VERCEL_OIDC_TOKEN has expired')
      expect(reason).toContain('Could not get credentials from OIDC context')
      expect(reason).toContain('npx vercel env pull .env.local')
    })

    it('reports missing credentials when nothing is configured', async () => {
      const result = await resolveSandboxCredentials(env())

      expect(result).toMatchObject({ ok: false, code: 'missing' })
      const reason = result.ok === false ? result.reason : ''
      expect(reason).toContain('not configured')
      expect(reason).toContain('npx vercel link')
      expect(reason).toContain('VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID')
    })

    it('rejects a token without team/project scope', async () => {
      const token = makeJwt({ exp: FUTURE_EXP })
      const result = await resolveSandboxCredentials(env({ VERCEL_OIDC_TOKEN: token }))

      expect(result).toMatchObject({ ok: false, code: 'invalid' })
    })

    it('bounds the refresh so a hung CLI call cannot stall the analysis', async () => {
      vi.useFakeTimers()
      getVercelOidcToken.mockImplementation(() => new Promise(() => {}))

      const pending = resolveSandboxCredentials(env())
      await vi.advanceTimersByTimeAsync(10_500)
      const result = await pending

      expect(result).toMatchObject({ ok: false, code: 'missing' })
      expect(result.ok === false && result.reason).toContain('Timed out refreshing the Vercel OIDC token')
    })
  })
})

describe('decodeJwtPayload', () => {
  it('extracts the fields we rely on', () => {
    const payload = decodeJwtPayload(makeJwt({ owner_id: 'team_x', project_id: 'prj_x', exp: 123, extra: true }))
    expect(payload).toEqual({ owner_id: 'team_x', project_id: 'prj_x', exp: 123 })
  })

  it('returns an empty payload for opaque or malformed tokens', () => {
    expect(decodeJwtPayload('vercel_pat_abc')).toEqual({})
    expect(decodeJwtPayload('a.b')).toEqual({})
    expect(decodeJwtPayload(`x.${Buffer.from('not json').toString('base64url')}.y`)).toEqual({})
    expect(decodeJwtPayload(undefined)).toEqual({})
  })
})
