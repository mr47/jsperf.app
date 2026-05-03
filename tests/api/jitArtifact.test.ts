import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadJitArtifactMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/jitArtifacts', () => ({
  loadJitArtifact: (...args) => loadJitArtifactMock(...args),
  jitArtifactDownloadName: () => 'jsperf-node-test-1-jit.txt',
}))

import handler from '../../pages/api/benchmark/jit-artifact/[id]'

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

describe('GET /api/benchmark/jit-artifact/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns artifact metadata and output as JSON', async () => {
    loadJitArtifactMock.mockResolvedValueOnce({
      id: 'abc123',
      runtime: 'node',
      runtimeName: 'node',
      version: null,
      label: null,
      testIndex: 0,
      profileLabel: '1x',
      meta: { format: 'txt', language: 'x86asm', lineCount: 2 },
      output: 'mov rax, rbx\nret',
    })

    const res = createMockRes()
    await handler(createMockReq({ id: 'abc123' }), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({
      id: 'abc123',
      runtime: 'node',
      output: 'mov rax, rbx\nret',
    })
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it('downloads raw text when requested', async () => {
    loadJitArtifactMock.mockResolvedValueOnce({
      id: 'abc123',
      runtime: 'node',
      output: 'mov rax, rbx\nret',
    })

    const res = createMockRes()
    await handler(createMockReq({ id: 'abc123', download: '1' }), res)

    expect(res._status).toBe(200)
    expect(res._send).toBe('mov rax, rbx\nret')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="jsperf-node-test-1-jit.txt"')
  })
})
