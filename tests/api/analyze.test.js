import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock external dependencies
vi.mock('../../lib/mongodb', () => ({
  analysesCollection: vi.fn(async () => ({
    insertOne: vi.fn(async () => ({ insertedId: 'mock_id' })),
  })),
}))

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))

vi.mock('@upstash/ratelimit', () => {
  class RatelimitMock {
    constructor() {}
    async limit() { return { success: true } }
    static slidingWindow() { return {} }
  }
  return { Ratelimit: RatelimitMock }
})

vi.mock('../../lib/engines/runner', () => ({
  runAnalysis: vi.fn(async (_tests, opts) => {
    opts?.onProgress?.({ engine: 'quickjs', testIndex: 0, status: 'running' })
    opts?.onProgress?.({ engine: 'quickjs', testIndex: 0, status: 'done' })
    opts?.onProgress?.({ engine: 'v8', testIndex: 0, status: 'running' })
    opts?.onProgress?.({ engine: 'v8', testIndex: 0, status: 'done' })
    opts?.onProgress?.({ engine: 'prediction', testIndex: 0, status: 'running' })
    opts?.onProgress?.({ engine: 'prediction', testIndex: 0, status: 'done' })

    return {
      results: [
        {
          testIndex: 0,
          title: 'test',
          quickjs: { opsPerSec: 1000, profiles: [{ state: 'completed', opsPerSec: 1000 }] },
          v8: { opsPerSec: 50000, profiles: [{ state: 'completed', opsPerSec: 50000 }] },
          prediction: {
            scalingType: 'linear',
            scalingConfidence: 0.95,
            jitBenefit: 50,
            memSensitivity: 0,
            predictedAt: { '1x': 50000, '2x': 100000 },
            characteristics: { cpuBound: true, memoryBound: false, allocationHeavy: false, jitFriendly: true },
          },
        },
      ],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
      hasErrors: false,
    }
  }),
}))

import handler from '../../pages/api/benchmark/analyze'

function createMockReq(body, method = 'POST') {
  return {
    method,
    body,
    headers: { 'x-forwarded-for': '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function createMockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    write: vi.fn(() => true),
    end: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    headersSent: false,
    _status: null,
    _json: null,
    _lines: [],
  }
  res.status.mockImplementation((code) => {
    res._status = code
    return res
  })
  res.json.mockImplementation((data) => {
    res._json = data
    return res
  })
  res.write.mockImplementation((chunk) => {
    res._lines.push(chunk)
    res.headersSent = true
    return true
  })
  return res
}

function parseNdjsonLines(res) {
  return res._lines
    .join('')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
}

describe('POST /api/benchmark/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 405 for non-POST methods', async () => {
    const req = createMockReq({}, 'GET')
    const res = createMockRes()

    await handler(req, res)

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST'])
    expect(res._status).toBe(405)
  })

  it('returns 400 for missing tests array', async () => {
    const req = createMockReq({})
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('tests array is required')
  })

  it('returns 400 for empty tests array', async () => {
    const req = createMockReq({ tests: [] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('tests array is required')
  })

  it('returns 400 for tests with empty code', async () => {
    const req = createMockReq({ tests: [{ code: '', title: 'test' }] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('non-empty code')
  })

  it('returns 400 for too many tests', async () => {
    const tests = Array.from({ length: 21 }, (_, i) => ({ code: `x + ${i}`, title: `test ${i}` }))
    const req = createMockReq({ tests })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('Maximum 20')
  })

  it('streams NDJSON with progress and result on cache miss', async () => {
    const req = createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson')
    expect(res.setHeader).toHaveBeenCalledWith('X-Analysis-Cache', 'MISS')
    expect(res.end).toHaveBeenCalled()

    const messages = parseNdjsonLines(res)
    const progressMsgs = messages.filter(m => m.type === 'progress')
    const resultMsgs = messages.filter(m => m.type === 'result')

    expect(progressMsgs.length).toBeGreaterThan(0)
    expect(progressMsgs.some(m => m.engine === 'quickjs')).toBe(true)
    expect(progressMsgs.some(m => m.engine === 'v8')).toBe(true)

    expect(resultMsgs).toHaveLength(1)
    expect(resultMsgs[0].data.results).toBeDefined()
    expect(resultMsgs[0].data.comparison).toBeDefined()
    expect(resultMsgs[0].data.results[0].quickjs).toBeDefined()
    expect(resultMsgs[0].data.results[0].v8).toBeDefined()
    expect(resultMsgs[0].data.results[0].prediction).toBeDefined()
  })

  it('returns cached result as standard JSON', async () => {
    const { redis } = await import('../../lib/redis')
    const cachedData = { results: [], comparison: {} }
    redis.get.mockResolvedValueOnce(JSON.stringify(cachedData))

    const req = createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('X-Analysis-Cache', 'HIT')
    expect(res.json).toHaveBeenCalled()
    expect(res.write).not.toHaveBeenCalled()
  })

  it('busts the Redis cache when force=true is set and skips the cache lookup', async () => {
    const { redis } = await import('../../lib/redis')

    const req = createMockReq({ tests: [{ code: 'x + 1', title: 'test' }], force: true })
    const res = createMockRes()

    await handler(req, res)

    expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/^analysis_v4:/))
    // With force=true the handler must not consult the cache, otherwise
    // a stale entry could short-circuit the streaming run.
    expect(redis.get).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('X-Analysis-Cache', 'MISS')
  })

  it('does not cache results with errors', async () => {
    const { runAnalysis } = await import('../../lib/engines/runner')
    const { redis } = await import('../../lib/redis')

    runAnalysis.mockResolvedValueOnce({
      results: [{
        testIndex: 0,
        title: 'test',
        quickjs: { opsPerSec: 1000, profiles: [{ state: 'completed', opsPerSec: 1000 }] },
        v8: { opsPerSec: 0, profiles: [{ state: 'errored', opsPerSec: 0, error: 'Sandbox failed' }] },
        prediction: { scalingType: 'noisy', scalingConfidence: 0, jitBenefit: 0, memSensitivity: 0, predictedAt: {}, characteristics: {} },
      }],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
      hasErrors: true,
    })

    const req = createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(redis.setex).not.toHaveBeenCalled()

    const messages = parseNdjsonLines(res)
    const resultMsg = messages.find(m => m.type === 'result')
    expect(resultMsg.data.hasErrors).toBe(true)
  })
})
