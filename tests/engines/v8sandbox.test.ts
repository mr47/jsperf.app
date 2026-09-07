// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Never let the unit tests reach the real OIDC refresh flow (Vercel CLI auth
// + network). Individual tests override the implementation as needed.
const getVercelOidcToken = vi.fn(async () => {
  throw new Error('Could not get credentials from OIDC context.')
})
vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: (...args) => getVercelOidcToken(...args),
}))

// Mock @vercel/sandbox for unit tests -- real sandbox requires Vercel credentials
const mockStdoutData = JSON.stringify({
  state: 'completed',
  opsPerSec: 150000,
  iterations: 300000,
  totalMs: 2000,
  latency: { mean: 0.0067, p50: 0.006, p99: 0.01, min: 0.005, max: 0.015, samplesCount: 10 },
  heapUsed: 4194304,
  heapTotal: 8388608,
  externalMemory: 1024,
  heapDelta: 2048,
})

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeOidcToken(payload) {
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.sig`
}

function snapshotVercelEnv() {
  return {
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  }
}

function restoreVercelEnv(snapshot) {
  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = snapshot[key]
    }
  }
}

vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn(async () => ({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: vi.fn(async () => mockStdoutData),
        stderr: vi.fn(async () => ''),
      })),
      stop: vi.fn(async () => ({})),
    })),
  },
}))

import { runInV8Sandbox } from '../../lib/engines/v8sandbox'

const ACCESS_TOKEN_ENV = {
  VERCEL_TOKEN: 'vercel_pat_test',
  VERCEL_TEAM_ID: 'team_test',
  VERCEL_PROJECT_ID: 'prj_test',
}

function clearVercelEnv() {
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_OIDC_TOKEN
  delete process.env.VERCEL_TEAM_ID
  delete process.env.VERCEL_PROJECT_ID
}

// Most tests exercise the sandbox run itself, so give them working
// access-token credentials by default. Credential-specific tests clear the
// environment and set exactly what they need.
let savedEnv
beforeEach(() => {
  savedEnv = snapshotVercelEnv()
  clearVercelEnv()
  Object.assign(process.env, ACCESS_TOKEN_ENV)
  getVercelOidcToken.mockClear()
})
afterEach(() => {
  restoreVercelEnv(savedEnv)
})

describe('runInV8Sandbox', () => {
  it('executes code in sandbox and returns valid results', async () => {
    const result = await runInV8Sandbox('var s = 0; for (var i = 0; i < 100; i++) s += i;')

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it('returns opsPerSec, heapUsed, latency fields', async () => {
    const result = await runInV8Sandbox('1 + 1')

    expect(result).toHaveProperty('opsPerSec')
    expect(result).toHaveProperty('heapUsed')
    expect(result).toHaveProperty('latency')
    expect(result.latency).toHaveProperty('mean')
    expect(result.latency).toHaveProperty('p50')
    expect(result.latency).toHaveProperty('p99')
    expect(result.latency).toHaveProperty('samplesCount')
  })

  it('parses the final JSON line when benchmark code logs to stdout', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: vi.fn(async () => `debug log\n${mockStdoutData}\n`),
        stderr: vi.fn(async () => ''),
      })),
      stop: vi.fn(async () => ({})),
    })

    const result = await runInV8Sandbox('console.log("debug log")')
    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBe(150000)
  })

  it('handles code that throws errors', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 1,
        stdout: vi.fn(async () => ''),
        stderr: vi.fn(async () => 'ReferenceError: foo is not defined'),
      })),
      stop: vi.fn(async () => ({})),
    })

    const result = await runInV8Sandbox('foo.bar.baz()')
    expect(result.state).toBe('errored')
    expect(result.error).toContain('ReferenceError')
  })

  it('handles sandbox creation failure', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockRejectedValueOnce(new Error('Sandbox quota exceeded'))

    const result = await runInV8Sandbox('1 + 1')
    expect(result.state).toBe('errored')
    expect(result.error).toContain('quota')
  })

  it('propagates parent aborts without waiting for blocking cleanup', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const controller = new AbortController()
    const stop = vi.fn(() => new Promise(resolve => setTimeout(resolve, 50)))

    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => {
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      }),
      stop,
    })

    await expect(runInV8Sandbox('1 + 1', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('passes snapshotId when provided', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()

    await runInV8Sandbox('1 + 1', { snapshotId: 'snap_123' })

    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: 'snapshot', snapshotId: 'snap_123' },
      })
    )
  })

  it('uses node24 runtime when no snapshot', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()

    await runInV8Sandbox('1 + 1')

    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'node24',
        networkPolicy: 'deny-all',
      })
    )
  })

  it('passes resolved credentials to the SDK so it never starts an interactive login', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()

    await runInV8Sandbox('1 + 1')

    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'vercel_pat_test',
        teamId: 'team_test',
        projectId: 'prj_test',
      })
    )
  })

  describe('without usable credentials', () => {
    it('returns state "unavailable" with the setup hint and never creates a sandbox', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      Sandbox.create.mockClear()
      clearVercelEnv()

      const result = await runInV8Sandbox('1 + 1')

      expect(result).toMatchObject({ state: 'unavailable', opsPerSec: 0, latency: null, heapUsed: 0 })
      expect(result.error).toContain('npx vercel env pull .env.local')
      expect(Sandbox.create).not.toHaveBeenCalled()
    })

    it('reports an expired OIDC token instead of hanging on the SDK login flow', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      Sandbox.create.mockClear()
      clearVercelEnv()
      process.env.VERCEL_OIDC_TOKEN = makeOidcToken({
        owner_id: 'team_test',
        project_id: 'prj_test',
        exp: Math.floor(Date.now() / 1000) - 3600,
      })

      const result = await runInV8Sandbox('1 + 1')

      expect(result.state).toBe('unavailable')
      expect(result.error).toContain('VERCEL_OIDC_TOKEN has expired')
      expect(getVercelOidcToken).toHaveBeenCalledTimes(1)
      expect(Sandbox.create).not.toHaveBeenCalled()
    })

    it('reports a personal access token that lacks team/project scope', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      Sandbox.create.mockClear()
      clearVercelEnv()
      process.env.VERCEL_TOKEN = 'vercel_pat_without_project_context'

      const result = await runInV8Sandbox('1 + 1')

      expect(result.state).toBe('unavailable')
      expect(result.error).toContain('VERCEL_TEAM_ID and VERCEL_PROJECT_ID')
      expect(Sandbox.create).not.toHaveBeenCalled()
    })

    it('runs once a refreshed OIDC token is available', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      Sandbox.create.mockClear()
      clearVercelEnv()
      const fresh = makeOidcToken({
        owner_id: 'team_fresh',
        project_id: 'prj_fresh',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
      getVercelOidcToken.mockResolvedValueOnce(fresh)

      const result = await runInV8Sandbox('1 + 1')

      expect(result.state).toBe('completed')
      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({ token: fresh, teamId: 'team_fresh', projectId: 'prj_fresh' })
      )
    })
  })

  it('stops the sandbox on the success path', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: vi.fn(async () => mockStdoutData),
        stderr: vi.fn(async () => ''),
      })),
      stop,
    })

    await runInV8Sandbox('1 + 1')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({
      blocking: true,
      signal: expect.any(AbortSignal),
    }))
  })

  it('stops the sandbox even when the run errors', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 1,
        stdout: vi.fn(async () => ''),
        stderr: vi.fn(async () => 'boom'),
      })),
      stop,
    })

    await runInV8Sandbox('throw new Error()')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({
      blocking: true,
      signal: expect.any(AbortSignal),
    }))
  })

  it('deletes the Vercel sandbox entity when a sandbox id and token are available', async () => {
    const env = snapshotVercelEnv()
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: vi.fn(async () => ''),
    }))

    try {
      delete process.env.VERCEL_TOKEN
      delete process.env.VERCEL_TEAM_ID
      delete process.env.VERCEL_PROJECT_ID
      process.env.VERCEL_OIDC_TOKEN = makeOidcToken({
        owner_id: 'team_test',
        project_id: 'prj_test',
      })
      vi.stubGlobal('fetch', fetchMock)

      Sandbox.create.mockResolvedValueOnce({
        sandboxId: 'sbx_delete_123',
        writeFiles: vi.fn(async () => {}),
        runCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: vi.fn(async () => mockStdoutData),
          stderr: vi.fn(async () => ''),
        })),
        stop,
      })

      await runInV8Sandbox('1 + 1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://api.vercel.com/v2/sandboxes/sbx_delete_123?projectId=prj_test&teamId=team_test')
      expect(options).toEqual(expect.objectContaining({
        method: 'DELETE',
        headers: { authorization: `Bearer ${process.env.VERCEL_OIDC_TOKEN}` },
        signal: expect.any(AbortSignal),
      }))
      expect(stop).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      restoreVercelEnv(env)
    }
  })

  it('falls back to stopping when Vercel delete does not find the sandbox entity', async () => {
    const env = snapshotVercelEnv()
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))

    try {
      delete process.env.VERCEL_TOKEN
      delete process.env.VERCEL_TEAM_ID
      delete process.env.VERCEL_PROJECT_ID
      process.env.VERCEL_OIDC_TOKEN = makeOidcToken({
        owner_id: 'team_test',
        project_id: 'prj_test',
      })
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 404,
        text: vi.fn(async () => ''),
      })))

      Sandbox.create.mockResolvedValueOnce({
        sandboxId: 'sbx_missing_123',
        writeFiles: vi.fn(async () => {}),
        runCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: vi.fn(async () => mockStdoutData),
          stderr: vi.fn(async () => ''),
        })),
        stop,
      })

      await runInV8Sandbox('1 + 1')
      expect(stop).toHaveBeenCalledTimes(1)
      expect(stop).toHaveBeenCalledWith(expect.objectContaining({
        blocking: true,
        signal: expect.any(AbortSignal),
      }))
    } finally {
      vi.unstubAllGlobals()
      restoreVercelEnv(env)
    }
  })

  it('deletes through the REST API with access-token credentials', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: vi.fn(async () => ''),
    }))

    try {
      vi.stubGlobal('fetch', fetchMock)

      Sandbox.create.mockResolvedValueOnce({
        sandboxId: 'sbx_pat_123',
        writeFiles: vi.fn(async () => {}),
        runCommand: vi.fn(async () => ({
          exitCode: 0,
          stdout: vi.fn(async () => mockStdoutData),
          stderr: vi.fn(async () => ''),
        })),
        stop,
      })

      await runInV8Sandbox('1 + 1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://api.vercel.com/v2/sandboxes/sbx_pat_123?projectId=prj_test&teamId=team_test')
      expect(options.headers).toEqual({ authorization: 'Bearer vercel_pat_test' })
      expect(stop).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createBenchmarkSnapshot', () => {
  it('stops the sandbox after taking the snapshot (no leak on success)', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    Sandbox.create.mockResolvedValueOnce({
      runCommand: vi.fn(async () => ({ exitCode: 0 })),
      snapshot: vi.fn(async () => ({ snapshotId: 'snap_abc' })),
      stop,
    })

    const { createBenchmarkSnapshot } = await import('../../lib/engines/v8sandbox')
    const id = await createBenchmarkSnapshot()

    expect(id).toBe('snap_abc')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({
      blocking: true,
      signal: expect.any(AbortSignal),
    }))
  })

  it('stops the sandbox when snapshot() throws', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    const stop = vi.fn(async () => ({}))
    Sandbox.create.mockResolvedValueOnce({
      runCommand: vi.fn(async () => ({ exitCode: 0 })),
      snapshot: vi.fn(async () => { throw new Error('snapshot failed') }),
      stop,
    })

    const { createBenchmarkSnapshot } = await import('../../lib/engines/v8sandbox')
    await expect(createBenchmarkSnapshot()).rejects.toThrow('snapshot failed')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('rejects with the credential reason when Vercel Sandbox is not configured', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()
    clearVercelEnv()

    const { createBenchmarkSnapshot } = await import('../../lib/engines/v8sandbox')
    await expect(createBenchmarkSnapshot()).rejects.toThrow(/npx vercel link/)
    expect(Sandbox.create).not.toHaveBeenCalled()
  })
})

// Integration test -- only runs when VERCEL_TOKEN is available
describe.skipIf(!process.env.VERCEL_TOKEN)('v8sandbox integration', () => {
  it('runs a real benchmark in a Firecracker microVM', async () => {
    vi.restoreAllMocks()
    const { runInV8Sandbox: realRun } = await import('../../lib/engines/v8sandbox')

    const result = await realRun(
      'var s = 0; for (var i = 0; i < 100; i++) s += i;',
      { timeMs: 1000 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
    expect(result.heapUsed).toBeGreaterThan(0)
  }, 60_000)
})
