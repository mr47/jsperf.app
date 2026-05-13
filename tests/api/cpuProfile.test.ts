import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadCpuProfileMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/cpuProfiles', () => ({
  loadCpuProfile: (...args: unknown[]) => loadCpuProfileMock(...args),
  getFocusedCpuProfile: (doc: any) => doc.focusedCpuProfile || doc.cpuProfile,
  cpuProfileDownloadName: () => 'jsperf-node-test-1-1x.cpuprofile',
}))

import handler from '../../pages/api/benchmark/cpu-profile/[id]'

function createMockReq(query: any, method = 'GET'): any {
  return { method, query }
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    send: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    end: vi.fn(() => res),
    _status: null,
    _json: null,
    _send: null,
  }
  res.status.mockImplementation((code) => { res._status = code; return res })
  res.json.mockImplementation((data) => { res._json = data; return res })
  res.send.mockImplementation((data) => { res._send = data; return res })
  return res
}

describe('GET /api/benchmark/cpu-profile/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the full profile and keeps the focused profile available', async () => {
    const cpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2] },
        { id: 2, callFrame: { functionName: 'runBenchmark', url: 'node:jsperf-worker' } },
      ],
      samples: [2],
      timeDeltas: [1000],
    }
    const focusedCpuProfile = {
      nodes: [{ id: 1, callFrame: { functionName: 'hot', url: 'jsperf-user-code.js' } }],
      samples: [1],
      timeDeltas: [1000],
    }

    loadCpuProfileMock.mockResolvedValueOnce({
      id: '1234567890abcdef12345678',
      runtime: 'node',
      cpuProfile,
      focusedCpuProfile,
      meta: { source: { code: 'hot()' } },
    })

    const res = createMockRes()
    await handler(createMockReq({ id: '1234567890abcdef12345678' }), res)

    expect(res._status).toBe(200)
    expect(res._json.cpuProfile).toBe(cpuProfile)
    expect(res._json.focusedCpuProfile).toBe(focusedCpuProfile)
    expect(res._json.meta.source.code).toBe('hot()')
  })
})
