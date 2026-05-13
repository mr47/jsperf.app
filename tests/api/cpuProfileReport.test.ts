import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadCpuProfileMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/cpuProfiles', () => ({
  loadCpuProfile: (...args: unknown[]) => loadCpuProfileMock(...args),
  getFocusedCpuProfile: (doc: any) => doc.focusedCpuProfile || doc.cpuProfile,
  cpuProfileDownloadName: () => 'jsperf-node-test-1-1x.cpuprofile',
}))

import handler from '../../pages/api/benchmark/cpu-profile/[id]/report'

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

describe('GET /api/benchmark/cpu-profile/[id]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a CPUpro report with the focused profile embedded', async () => {
    loadCpuProfileMock.mockResolvedValueOnce({
      id: '1234567890abcdef12345678',
      cpuProfile: {
        nodes: [{ id: 1, callFrame: { functionName: '(root)', url: '' } }],
        samples: [1],
        timeDeltas: [1000],
      },
      focusedCpuProfile: {
        nodes: [{ id: 1, callFrame: { functionName: 'hot', url: 'jsperf-user-code.js' } }],
        samples: [1],
        timeDeltas: [1000],
      },
    })

    const res = createMockRes()
    await handler(createMockReq({ id: '1234567890abcdef12345678' }), res)

    expect(res._status).toBe(200)
    expect(res._send).toContain('discoveryLoader.start')
    expect(res._send).toContain('discoveryLoader.finish')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="jsperf-node-test-1-1x.html"')
  })
})
