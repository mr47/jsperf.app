// @ts-nocheck
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const insertOneMock = vi.hoisted(() => vi.fn(async () => ({ insertedId: 'mock_id' })))
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())

// Mock external dependencies
vi.mock('../../lib/mongodb', () => ({
  analysesCollection: vi.fn(async () => ({
    insertOne: insertOneMock,
  })),
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args) => multiRuntimeFindMock(...args),
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
    if (opts?.estimateComplexities) {
      opts?.onProgress?.({ engine: 'complexity', testIndex: 0, status: 'running' })
      opts?.onProgress?.({ engine: 'complexity', testIndex: 0, status: 'done' })
    }
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
          complexity: opts?.estimateComplexities ? {
            version: 1,
            time: { notation: 'O(1)', label: 'constant', confidence: 0.9 },
            space: { notation: 'O(1)', label: 'constant', confidence: 0.88 },
            async: { mode: 'none', concurrency: 'sync', notes: [] },
            explanation: 'Only constant work detected.',
            signals: [],
          } : null,
        },
      ],
      comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
      hasErrors: false,
    }
  }),
}))

import handler from '../../pages/api/benchmark/analyze'

const ORIG_WORKER_URL = process.env.BENCHMARK_WORKER_URL
const ORIG_FETCH = globalThis.fetch

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
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
    delete process.env.BENCHMARK_WORKER_URL
    globalThis.fetch = ORIG_FETCH
  })

  afterEach(() => {
    if (ORIG_WORKER_URL) process.env.BENCHMARK_WORKER_URL = ORIG_WORKER_URL
    else delete process.env.BENCHMARK_WORKER_URL
    globalThis.fetch = ORIG_FETCH
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
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-1', deadlineMs: 30000 }),
      text: async () => JSON.stringify({ jobId: 'job-1' }),
    }))

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
    expect(progressMsgs.some(m => m.engine === 'complexity')).toBe(true)

    expect(resultMsgs).toHaveLength(1)
    expect(resultMsgs[0].data.results).toBeDefined()
    expect(resultMsgs[0].data.comparison).toBeDefined()
    expect(resultMsgs[0].data.results[0].quickjs).toBeDefined()
    expect(resultMsgs[0].data.results[0].v8).toBeDefined()
    expect(resultMsgs[0].data.results[0].prediction).toBeDefined()
    expect(resultMsgs[0].data.results[0].complexity).toBeDefined()
    expect(insertOneMock).toHaveBeenCalledWith(expect.objectContaining({
      codeHash: expect.any(String),
      multiRuntimeCacheKey: expect.any(String),
    }))
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

    expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/^analysis_v8:/))
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
        complexity: { time: { notation: 'O(1)' }, space: { notation: 'O(1)' }, async: { mode: 'none' } },
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

  it('forwards requested runtime versions to multi-runtime jobs', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-1', deadlineMs: 30000 }),
      text: async () => JSON.stringify({ jobId: 'job-1' }),
    }))

    const req = createMockReq({
      tests: [{ code: 'x + 1', title: 'test' }],
      runtimes: ['node@lts', 'node@24.11.1', 'bun@1.3.0'],
    })
    const res = createMockRes()

    await handler(req, res)

    const [, init] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(init.body).runtimes).toEqual(['node@lts', 'node@24.11.1', 'bun@1.3.0'])
  })

  it('skips multi-runtime jobs for browser API snippets', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn()

    const req = createMockReq({
      tests: [{ code: 'document.createElement("div")', title: 'browser test' }],
    })
    const res = createMockRes()

    await handler(req, res)

    expect(globalThis.fetch).not.toHaveBeenCalled()
    const messages = parseNdjsonLines(res)
    const unavailable = messages.find(m => m.type === 'multi-runtime-unavailable')
    expect(unavailable.error).toContain('browser APIs')
    expect(unavailable.error).toContain('document')
  })

  it('only enqueues non-browser tests for multi-runtime analysis', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-1', deadlineMs: 30000 }),
      text: async () => JSON.stringify({ jobId: 'job-1' }),
    }))

    const req = createMockReq({
      tests: [
        { code: 'document.body.appendChild(el)', title: 'browser test' },
        { code: 'x + 1', title: 'server-safe test' },
      ],
    })
    const res = createMockRes()

    await handler(req, res)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, init] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(init.body).code).toBe('x + 1')

    const messages = parseNdjsonLines(res)
    const enqueued = messages.find(m => m.type === 'multi-runtime-enqueued')
    expect(enqueued.jobs).toEqual([{ testIndex: 1, jobId: 'job-1' }])
  })

  it('uses stored multi-runtime results without enqueueing worker jobs', async () => {
    const { redis } = await import('../../lib/redis')
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn()
    redis.get.mockResolvedValueOnce(null) // base analysis cache miss
    multiRuntimeFindMock.mockReturnValueOnce({ toArray: vi.fn(async () => [{
      testIndex: 0,
      runtimes: { node: { profiles: [], avgOpsPerSec: 1000 } },
      runtimeComparison: { available: true, runtimes: [], ranking: [] },
    }]) })

    const req = createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] })
    const res = createMockRes()

    await handler(req, res)

    expect(globalThis.fetch).not.toHaveBeenCalled()
    const messages = parseNdjsonLines(res)
    expect(messages.some(m => m.type === 'multi-runtime-stored')).toBe(true)
  })

  it('returns 400 for unsupported TypeScript module syntax before streaming', async () => {
    const req = createMockReq({
      language: 'typescript',
      tests: [{ code: 'import { x } from "pkg"\nreturn x', title: 'test' }],
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json.error).toContain('import/export')
    expect(res.write).not.toHaveBeenCalled()
  })

  it('compiles TypeScript for QuickJS/V8 while forwarding original and runtime sources to the worker', async () => {
    const { runAnalysis } = await import('../../lib/engines/runner')
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-1', deadlineMs: 30000 }),
      text: async () => JSON.stringify({ jobId: 'job-1' }),
    }))

    const req = createMockReq({
      language: 'typescript',
      languageOptions: { target: 'es2022', runtimeMode: 'native-where-available' },
      setup: 'const seed: number = 1',
      teardown: 'const done: boolean = true',
      tests: [{ code: 'const value: number = seed + 1\nreturn value as number', title: 'typed' }],
    })
    const res = createMockRes()

    await handler(req, res)

    const [workerUrl, init] = globalThis.fetch.mock.calls[0]
    expect(workerUrl).toBe('http://worker.test/api/jobs')
    const body = JSON.parse(init.body)
    expect(body.language).toBe('typescript')
    expect(body.languageOptions).toMatchObject({ target: 'es2022', runtimeMode: 'native-where-available' })
    expect(body.code).toContain('value: number')
    expect(body.runtimeCode).toContain('const value = seed + 1')
    expect(body.runtimeSetup).toContain('const seed = 1')
    expect(body.runtimeTeardown).toContain('const done = true')

    expect(runAnalysis).toHaveBeenCalledWith(
      [expect.objectContaining({ code: expect.stringContaining('const value = seed + 1') })],
      expect.objectContaining({
        setup: expect.stringContaining('const seed = 1'),
        teardown: expect.stringContaining('const done = true'),
      }),
    )

    const messages = parseNdjsonLines(res)
    const result = messages.find(m => m.type === 'result')?.data
    expect(result.meta.language).toBe('typescript')
    expect(result.meta.sourcePrepMs).toEqual(expect.any(Number))
    expect(result.meta.compiler.version).toEqual(expect.any(String))
  })

  it('infers TypeScript from setup before deep analysis when language metadata is missing', async () => {
    const { runAnalysis } = await import('../../lib/engines/runner')
    process.env.BENCHMARK_WORKER_URL = ''

    const req = createMockReq({
      setup: 'type ClickEvent = { x: number }\nconst event: ClickEvent = { x: 1 }',
      tests: [{ code: 'return event.x as number', title: 'typed setup' }],
    })
    const res = createMockRes()

    await handler(req, res)

    expect(runAnalysis).toHaveBeenCalledWith(
      [expect.objectContaining({ code: expect.stringContaining('return event.x') })],
      expect.objectContaining({
        setup: expect.stringContaining('const event = { x: 1 }'),
      }),
    )

    const messages = parseNdjsonLines(res)
    const result = messages.find(m => m.type === 'result')?.data
    expect(result.meta.language).toBe('typescript')
  })
})
