import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest'

const redisStore = vi.hoisted(() => new Map())
const insertOneMock = vi.hoisted(() => vi.fn(async () => ({ insertedId: 'mock_id' })))
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (key) => redisStore.get(key) || null),
    setex: vi.fn(async (key, _ttl, value) => {
      redisStore.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (key) => {
      redisStore.delete(key)
      return 1
    }),
  },
}))

vi.mock('../../lib/mongodb', () => ({
  analysesCollection: vi.fn(async () => ({
    insertOne: insertOneMock,
  })),
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args: any[]) => (multiRuntimeFindMock as any)(...args),
  })),
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
  runQuickJSAnalysis: vi.fn(async () => [[
    { label: '1x', resourceLevel: 1, opsPerSec: 1000, state: 'completed' },
  ]]),
  runV8Analysis: vi.fn(async () => [[
    { label: '1x', resourceLevel: 1, vcpus: 1, opsPerSec: 50000, state: 'completed' },
  ]]),
  buildAnalysisFromProfiles: vi.fn((tests, { quickjsProfiles, v8Profiles, complexities }) => ({
    results: tests.map((test, i) => ({
      testIndex: i,
      title: test.title,
      quickjs: { opsPerSec: quickjsProfiles[i][0].opsPerSec, profiles: quickjsProfiles[i] },
      v8: { opsPerSec: v8Profiles[i][0].opsPerSec, profiles: v8Profiles[i] },
      prediction: { scalingType: 'linear', scalingConfidence: 0.95, jitBenefit: 50 },
      complexity: complexities?.[i] || null,
    })),
    comparison: { fastestByAlgorithm: 0, fastestByRuntime: 0, divergence: false },
    hasErrors: false,
  })),
}))

vi.mock('../../lib/engines/complexity', () => ({
  estimateComplexitiesOnWorker: vi.fn(async () => [{
    version: 1,
    time: { notation: 'O(1)', label: 'constant', confidence: 0.9 },
    space: { notation: 'O(1)', label: 'constant', confidence: 0.9 },
    async: { mode: 'none', concurrency: 'sync', notes: [] },
    explanation: 'constant',
    signals: [],
  }]),
}))

vi.mock('../../lib/engines/multiruntime', () => ({
  enqueueMultiRuntimeJob: vi.fn(async () => ({ jobId: 'job-1', deadlineMs: 30_000 })),
}))

vi.mock('../../lib/engines/workerComposite', () => ({
  runWorkerCompositeAnalysis: vi.fn(async () => ({
    quickjsProfiles: [[
      { label: '1x', resourceLevel: 1, opsPerSec: 2000, state: 'completed' },
    ]],
    complexities: [{
      version: 1,
      time: { notation: 'O(1)', label: 'constant', confidence: 0.9 },
      space: { notation: 'O(1)', label: 'constant', confidence: 0.9 },
      async: { mode: 'none', concurrency: 'sync', notes: [] },
      explanation: 'constant',
      signals: [],
    }],
    multiRuntime: {
      jobs: [{ testIndex: 0, jobId: 'worker-composite-job' }],
      deadlineMs: 30_000,
      deadlineAt: Date.now() + 30_000,
      cacheKey: 'cache-key',
    },
  })),
}))

import startHandler from '../../pages/api/benchmark/analyze/start'
import quickjsHandler from '../../pages/api/benchmark/analyze/quickjs'
import v8Handler from '../../pages/api/benchmark/analyze/v8'
import workerHandler from '../../pages/api/benchmark/analyze/worker'
import finalizeHandler from '../../pages/api/benchmark/analyze/finalize'
import donorJobHandler from '../../pages/api/benchmark/analyze/donor-job'
import {
  createAnalysisSession,
  prepareDeepAnalysisRequest,
  saveAnalysisSession,
  WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
} from '../../lib/benchmark/deepAnalysis'

const ORIG_WORKER_URL = process.env.BENCHMARK_WORKER_URL

function createMockReq(body: any, method = 'POST', headers: Record<string, string> = {}): any {
  return {
    method,
    body,
    headers: { 'x-forwarded-for': '127.0.0.1', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    _status: null,
    _json: null,
  }
  res.status.mockImplementation((code) => {
    res._status = code
    return res
  })
  res.json.mockImplementation((data) => {
    res._json = data
    return res
  })
  return res
}

describe('split deep analysis API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisStore.clear()
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
  })

  afterEach(() => {
    if (ORIG_WORKER_URL) process.env.BENCHMARK_WORKER_URL = ORIG_WORKER_URL
    else delete process.env.BENCHMARK_WORKER_URL
  })

  it('starts one session, fans out engines and worker, then finalizes once', async () => {
    const body = { tests: [{ code: 'x + 1', title: 'test' }] }
    const startRes = createMockRes()
    await startHandler(createMockReq(body), startRes)

    expect(startRes._status).toBe(200)
    expect(startRes._json.sessionId).toEqual(expect.any(String))
    expect(startRes._json.pipeline).toEqual(['quickjs', 'v8', 'multi-runtime', 'complexity', 'prediction'])

    const sessionBody = { sessionId: startRes._json.sessionId }
    const [quickjsRes, v8Res, workerRes] = [createMockRes(), createMockRes(), createMockRes()]
    await Promise.all([
      quickjsHandler(createMockReq(sessionBody), quickjsRes),
      v8Handler(createMockReq(sessionBody), v8Res),
      workerHandler(createMockReq(sessionBody), workerRes),
    ])

    expect(quickjsRes._json.profiles[0][0].opsPerSec).toBe(1000)
    expect(v8Res._json.profiles[0][0].opsPerSec).toBe(50000)
    expect(workerRes._json.complexities[0].time.notation).toBe('O(1)')
    expect(workerRes._json.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'job-1' }])
    expect(workerRes._json.multiRuntime.deadlineAt).toEqual(expect.any(Number))

    const finalizeRes = createMockRes()
    await finalizeHandler(createMockReq({
      sessionId: startRes._json.sessionId,
      quickjsProfiles: quickjsRes._json.profiles,
      v8Profiles: v8Res._json.profiles,
      complexities: workerRes._json.complexities,
      multiRuntime: workerRes._json.multiRuntime,
    }), finalizeRes)

    expect(finalizeRes._status).toBe(200)
    expect(finalizeRes._json.results[0].quickjs.opsPerSec).toBe(1000)
    expect(finalizeRes._json.results[0].v8.opsPerSec).toBe(50000)
    expect(finalizeRes._json.results[0].complexity.time.notation).toBe('O(1)')
    expect(finalizeRes._json.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'job-1' }])
    expect(insertOneMock).toHaveBeenCalledTimes(1)
  })

  it('preserves worker poll deadlines longer than the base 60 second route limit', async () => {
    const { enqueueMultiRuntimeJob } = await import('../../lib/engines/multiruntime')
    ;(enqueueMultiRuntimeJob as Mock).mockResolvedValueOnce({ jobId: 'slow-job', deadlineMs: 120_000 })

    const startRes = createMockRes()
    await startHandler(createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] }), startRes)

    const workerRes = createMockRes()
    await workerHandler(createMockReq({ sessionId: startRes._json.sessionId }), workerRes)

    expect(workerRes._json.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'slow-job' }])
    expect(workerRes._json.multiRuntime.deadlineMs).toBe(120_000)
    expect(workerRes._json.multiRuntime.deadlineAt).toBeGreaterThan(Date.now() + 60_000)
  })

  it('defaults donor starts to Node CPU profiling unless explicitly disabled', async () => {
    const token = 'a'.repeat(64)
    redisStore.set('donor:session:' + token, JSON.stringify({ name: 'Ada', source: 'test' }))
    const donorHeaders = { cookie: `jsperf_donor=${token}` }

    const defaultRes = createMockRes()
    await startHandler(createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] }, 'POST', donorHeaders), defaultRes)

    expect(defaultRes._status).toBe(200)
    expect(defaultRes._json.tier).toBe('donor')
    const defaultSession = JSON.parse(redisStore.get(`analysis_session:${defaultRes._json.sessionId}`))
    expect(defaultSession.multiRuntimeOptions.profiling).toEqual({ nodeCpu: true })

    const optedOutRes = createMockRes()
    await startHandler(createMockReq({
      tests: [{ code: 'x + 1', title: 'test' }],
      profiling: { nodeCpu: false },
    }, 'POST', donorHeaders), optedOutRes)

    expect(optedOutRes._status).toBe(200)
    const optedOutSession = JSON.parse(redisStore.get(`analysis_session:${optedOutRes._json.sessionId}`))
    expect(optedOutSession.multiRuntimeOptions.profiling).toEqual({ nodeCpu: false })
  })

  it('advances donor deep analysis across resumable poll requests', async () => {
    const prepared = prepareDeepAnalysisRequest({ tests: [{ code: 'x + 1', title: 'test' }] })
    if (prepared.error) throw new Error('unexpected preparation error')

    const session = createAnalysisSession({ ...prepared, tier: 'donor' })
    await saveAnalysisSession(session)

    let jobId: string | null = null
    const responses = []
    for (let i = 0; i < 4; i++) {
      const res = createMockRes()
      await donorJobHandler(createMockReq({ sessionId: session.id, jobId }), res)
      expect(res._status).toBe(200)
      jobId = res._json.jobId
      responses.push(res._json)
    }

    expect(responses.map(r => r.phase)).toEqual(['quickjs', 'v8', 'prediction', 'done'])
    expect(responses[0].multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'job-1' }])
    expect(responses[3].status).toBe('done')
    expect(responses[3].analysis.results[0].quickjs.opsPerSec).toBe(1000)
    expect(responses[3].analysis.results[0].v8.opsPerSec).toBe(50000)
    expect(responses[3].analysis.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'job-1' }])
    expect(insertOneMock).toHaveBeenCalledTimes(1)
  })

  it('runs donor QuickJS composite on the worker and skips app-side QuickJS', async () => {
    const { runQuickJSAnalysis } = await import('../../lib/engines/runner')
    const { runWorkerCompositeAnalysis } = await import('../../lib/engines/workerComposite')
    const prepared = prepareDeepAnalysisRequest({
      tests: [{ code: 'x + 1', title: 'test' }],
      workerExecutionMode: WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
    })
    if (prepared.error) throw new Error('unexpected preparation error')

    const session = createAnalysisSession({
      ...prepared,
      tier: 'donor',
      workerExecutionMode: WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
    })
    await saveAnalysisSession(session)

    let jobId: string | null = null
    const responses = []
    for (let i = 0; i < 3; i++) {
      const res = createMockRes()
      await donorJobHandler(createMockReq({ sessionId: session.id, jobId }), res)
      expect(res._status).toBe(200)
      jobId = res._json.jobId
      responses.push(res._json)
    }

    expect(responses.map(r => r.phase)).toEqual(['v8', 'prediction', 'done'])
    expect(runWorkerCompositeAnalysis).toHaveBeenCalledTimes(1)
    expect(runQuickJSAnalysis).not.toHaveBeenCalled()
    expect(responses[2].analysis.results[0].quickjs.opsPerSec).toBe(2000)
    expect(responses[2].analysis.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'worker-composite-job' }])
  })

  it('rejects worker-side QuickJS mode for non-donor starts', async () => {
    const res = createMockRes()
    await startHandler(createMockReq({
      tests: [{ code: 'x + 1', title: 'test' }],
      workerExecutionMode: WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
    }), res)

    expect(res._status).toBe(403)
    expect(res._json.error).toContain('requires an active donor session')
  })

  it('rejects donor job polling for non-donor sessions', async () => {
    const startRes = createMockRes()
    await startHandler(createMockReq({ tests: [{ code: 'x + 1', title: 'test' }] }), startRes)

    const res = createMockRes()
    await donorJobHandler(createMockReq({ sessionId: startRes._json.sessionId }), res)

    expect(res._status).toBe(403)
    expect(res._json.error).toContain('Donor deep analysis jobs require')
  })
})
