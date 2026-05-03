import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadStoredMultiRuntimeResultsMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('../../lib/multiRuntimeResults', () => ({
  loadStoredMultiRuntimeResults: loadStoredMultiRuntimeResultsMock,
}))

import { runWorkerCompositeAnalysis } from '../../lib/engines/workerComposite'

const ORIG_FETCH = globalThis.fetch
const ORIG_URL = process.env.BENCHMARK_WORKER_URL
const ORIG_SECRET = process.env.BENCHMARK_WORKER_SECRET

function session(overrides = {}) {
  return {
    multiRuntimeCacheKey: 'mr-cache',
    multiRuntimeOptions: {},
    prepared: {
      language: 'javascript',
      languageOptions: null,
      compilerVersion: null,
      sourcePrepVersion: 1,
      original: {
        setup: 'const x = 1',
        teardown: '',
        tests: [{ code: 'x + 1', title: 'test' }],
      },
      runtime: {
        setup: 'const x = 1',
        teardown: '',
        tests: [{ code: 'x + 1', title: 'test' }],
      },
    },
    ...overrides,
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

describe('runWorkerCompositeAnalysis', () => {
  beforeEach(() => {
    process.env.BENCHMARK_WORKER_URL = 'https://worker.example'
    process.env.BENCHMARK_WORKER_SECRET = 'secret'
    globalThis.fetch = vi.fn() as any
    loadStoredMultiRuntimeResultsMock.mockResolvedValue(null)
  })

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
    if (ORIG_URL) process.env.BENCHMARK_WORKER_URL = ORIG_URL
    else delete process.env.BENCHMARK_WORKER_URL
    if (ORIG_SECRET) process.env.BENCHMARK_WORKER_SECRET = ORIG_SECRET
    else delete process.env.BENCHMARK_WORKER_SECRET
  })

  it('returns unavailable when no worker is configured', async () => {
    delete process.env.BENCHMARK_WORKER_URL

    const result = await runWorkerCompositeAnalysis(session())

    expect(result).toMatchObject({ unavailable: true })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('posts QuickJS, complexity, and runtime enqueue work to the composite endpoint', async () => {
    const quickjsProfiles = [[{ label: '1x', opsPerSec: 1000, state: 'completed' }]]
    const complexities = [{ time: { notation: 'O(1)' } }]
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => jsonResponse({
      quickjsProfiles,
      complexities,
      multiRuntime: { jobs: [{ testIndex: 0, jobId: 'job-1' }], deadlineMs: 30_000 },
    }) as any)

    const result = await runWorkerCompositeAnalysis(session())

    expect(result.quickjsProfiles).toBe(quickjsProfiles)
    expect(result.complexities).toBe(complexities)
    expect(result.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'job-1' }])
    expect(result.multiRuntime.deadlineAt).toEqual(expect.any(Number))

    const [url, initRaw] = fetchMock.mock.calls[0]
    const init = initRaw as RequestInit & { headers: Record<string, string>, body: string }
    expect(url).toBe('https://worker.example/api/analysis/jobs')
    expect(init.headers.Authorization).toBe('Bearer secret')
    const body = JSON.parse(init.body)
    expect(body.quickjs.tests).toEqual([{ code: 'x + 1', title: 'test' }])
    expect(body.complexity.tests).toEqual([{ code: 'x + 1', title: 'test' }])
    expect(body.multiRuntime.tests[0]).toMatchObject({
      testIndex: 0,
      code: 'x + 1',
      runtimeCode: 'x + 1',
      setup: 'const x = 1',
      runtimeSetup: 'const x = 1',
    })
  })

  it('uses stored multi-runtime results without enqueueing runtime jobs', async () => {
    loadStoredMultiRuntimeResultsMock.mockResolvedValueOnce({
      results: [{ testIndex: 0, state: 'done', runtimes: {}, runtimeComparison: { available: true } }],
      fromStore: true,
      cacheKey: 'mr-cache',
    })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => jsonResponse({
      quickjsProfiles: [[{ label: '1x', opsPerSec: 1000, state: 'completed' }]],
      complexities: [null],
      multiRuntime: null,
    }) as any)

    const result = await runWorkerCompositeAnalysis(session())

    expect(result.multiRuntime.stored).toBe(true)
    const [, initRaw] = fetchMock.mock.calls[0]
    const init = initRaw as RequestInit & { body: string }
    expect(JSON.parse(init.body).multiRuntime.tests).toEqual([])
  })

  it('bypasses stored multi-runtime results for JIT runs without stored artifacts', async () => {
    loadStoredMultiRuntimeResultsMock.mockResolvedValueOnce({
      results: [{
        testIndex: 0,
        state: 'done',
        runtimes: {
          node: { profiles: [{ label: '1x', opsPerSec: 1000 }] },
        },
        runtimeComparison: { available: true },
      }],
      fromStore: true,
      cacheKey: 'mr-cache',
    })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => jsonResponse({
      quickjsProfiles: [[{ label: '1x', opsPerSec: 1000, state: 'completed' }]],
      complexities: [null],
      multiRuntime: { jobs: [{ testIndex: 0, jobId: 'jit-job' }], deadlineMs: 30_000 },
    }) as any)

    const result = await runWorkerCompositeAnalysis(session({
      multiRuntimeOptions: { profiling: { nodeCpu: true, v8Jit: true } },
    }))

    expect(result.multiRuntime.jobs).toEqual([{ testIndex: 0, jobId: 'jit-job' }])
    const [, initRaw] = fetchMock.mock.calls[0]
    const init = initRaw as RequestInit & { body: string }
    const body = JSON.parse(init.body)
    expect(body.multiRuntime.tests).toHaveLength(1)
    expect(body.multiRuntime.tests[0].profiling).toEqual({ nodeCpu: true, v8Jit: true })
  })

  it('uses stored multi-runtime results for JIT runs that already have artifacts', async () => {
    loadStoredMultiRuntimeResultsMock.mockResolvedValueOnce({
      results: [{
        testIndex: 0,
        state: 'done',
        runtimes: {
          node: { profiles: [{ label: '1x', jitArtifactRef: { id: 'jit-1' } }] },
        },
        runtimeComparison: { available: true },
      }],
      fromStore: true,
      cacheKey: 'mr-cache',
    })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => jsonResponse({
      quickjsProfiles: [[{ label: '1x', opsPerSec: 1000, state: 'completed' }]],
      complexities: [null],
      multiRuntime: null,
    }) as any)

    const result = await runWorkerCompositeAnalysis(session({
      multiRuntimeOptions: { profiling: { nodeCpu: true, v8Jit: true } },
    }))

    expect(result.multiRuntime.stored).toBe(true)
    const [, initRaw] = fetchMock.mock.calls[0]
    const init = initRaw as RequestInit & { body: string }
    expect(JSON.parse(init.body).multiRuntime.tests).toEqual([])
  })

  it('reports malformed QuickJS profiles as unavailable', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => jsonResponse({
      quickjsProfiles: [],
      complexities: [],
    }) as any)

    const result = await runWorkerCompositeAnalysis(session())

    expect(result).toMatchObject({
      unavailable: true,
      error: 'Worker response missing QuickJS profiles',
    })
  })
})
