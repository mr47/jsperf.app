import { describe, expect, it, vi, beforeEach } from 'vitest'

const getJobMock = vi.hoisted(() => vi.fn())
const buildRuntimeComparisonMock = vi.hoisted(() => vi.fn())
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())
const updateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))
const cpuProfileUpdateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))

vi.mock('../../lib/engines/multiruntime', () => ({
  getMultiRuntimeJob: (...args) => getJobMock(...args),
}))

vi.mock('../../lib/prediction/model', () => ({
  buildRuntimeComparison: (...args) => buildRuntimeComparisonMock(...args),
}))

vi.mock('../../lib/mongodb', () => ({
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args: any[]) => (multiRuntimeFindMock as any)(...args),
    updateOne: (...args: any[]) => (updateOneMock as any)(...args),
  })),
  cpuProfilesCollection: vi.fn(async () => ({
    updateOne: (...args: any[]) => (cpuProfileUpdateOneMock as any)(...args),
  })),
}))

import handler from '../../pages/api/benchmark/multi-runtime/events'

function createMockReq(query: any, method = 'GET'): any {
  return {
    method,
    query,
    on: vi.fn(),
  }
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn(),
    json: vi.fn(),
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    _status: null,
    _json: null,
    _body: '',
  }
  res.status.mockImplementation((code) => { res._status = code; return res })
  res.json.mockImplementation((data) => { res._json = data; return res })
  res.write.mockImplementation((chunk) => {
    res._body += chunk
    return true
  })
  return res
}

describe('GET /api/benchmark/multi-runtime/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
  })

  it('streams shaped multi-runtime worker updates over SSE', async () => {
    const runtimes = { node: { avgOpsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] } }
    const runtimeComparison = { available: true, fastestRuntime: 'node', runtimes: [] }
    getJobMock.mockResolvedValueOnce({ state: 'done', result: { runtimes } })
    buildRuntimeComparisonMock.mockReturnValueOnce(runtimeComparison)

    const res = createMockRes()
    await handler(createMockReq({
      jobs: '0:job-1',
      testIndex: '0',
      codeHash: 'mr-key',
      deadlineMs: '120000',
    }), res)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream; charset=utf-8',
    }))
    expect(res._body).toContain('event: ready')
    expect(res._body).toContain('event: multi-runtime')
    expect(res._body).toContain('"testIndex":0')
    expect(res._body).toContain('"state":"done"')
    expect(res._body).toContain('event: done')
    expect(updateOneMock).toHaveBeenCalled()
  })

  it('stores successful runtime data when another runtime failed', async () => {
    const runtimes = {
      node: {
        runtime: 'node',
        profiles: [{ label: '1x', state: 'completed', opsPerSec: 1000 }],
        avgOpsPerSec: 1000,
        error: null,
      },
      deno: {
        runtime: 'deno',
        profiles: [{ label: '1x', state: 'errored', opsPerSec: 0, error: 'Failed to parse runtime output' }],
        avgOpsPerSec: 0,
        error: 'Failed to parse runtime output',
      },
    }
    const runtimeComparison = {
      available: true,
      fastestRuntime: 'node',
      runtimes: [
        { runtime: 'node', avgOpsPerSec: 1000, profiles: [{ opsPerSec: 1000 }] },
        { runtime: 'deno', avgOpsPerSec: 0, hasError: true, profiles: [{ opsPerSec: 0 }] },
      ],
    }
    getJobMock.mockResolvedValueOnce({ state: 'done', result: { runtimes } })
    buildRuntimeComparisonMock.mockReturnValueOnce(runtimeComparison)

    const res = createMockRes()
    await handler(createMockReq({
      jobs: '0:job-1',
      codeHash: 'mr-key',
      deadlineMs: '120000',
    }), res)

    expect(res._body).toContain('"state":"done"')
    expect(res._body).toContain('"deno"')
    expect(updateOneMock).toHaveBeenCalled()
    const update = (updateOneMock.mock.calls[0] as any[])[1]
    expect(update.$set.runtimes.node.profiles[0].state).toBe('completed')
    expect(update.$set.runtimes.deno.profiles[0].state).toBe('errored')
  })

  it('returns 400 when no jobs are provided', async () => {
    const res = createMockRes()
    await handler(createMockReq({}), res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('jobs')
  })
})
