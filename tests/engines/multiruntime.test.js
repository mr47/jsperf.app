/**
 * Tests for the multi-runtime engine (jsperf.net side, not the worker side).
 *
 * The engine talks to a remote worker via two endpoints:
 *   POST /api/jobs         enqueueMultiRuntimeJob → { jobId }
 *   GET  /api/jobs/:id     getMultiRuntimeJob   → { state, result, ... }
 *
 * Global fetch is mocked so we exercise the env-var gate, auth header,
 * error paths, and 404 handling without standing up a real worker.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  enqueueMultiRuntimeJob,
  getMultiRuntimeJob,
} from '../../lib/engines/multiruntime.js'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

const ORIG_FETCH = globalThis.fetch
const ORIG_URL = process.env.BENCHMARK_WORKER_URL
const ORIG_SECRET = process.env.BENCHMARK_WORKER_SECRET

beforeEach(() => {
  delete process.env.BENCHMARK_WORKER_URL
  delete process.env.BENCHMARK_WORKER_SECRET
})

afterEach(() => {
  globalThis.fetch = ORIG_FETCH
  if (ORIG_URL) process.env.BENCHMARK_WORKER_URL = ORIG_URL
  else delete process.env.BENCHMARK_WORKER_URL
  if (ORIG_SECRET) process.env.BENCHMARK_WORKER_SECRET = ORIG_SECRET
  else delete process.env.BENCHMARK_WORKER_SECRET
})

describe('enqueueMultiRuntimeJob', () => {
  it('returns null when BENCHMARK_WORKER_URL is unset', async () => {
    globalThis.fetch = vi.fn()
    const result = await enqueueMultiRuntimeJob('1+1')
    expect(result).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('POSTs to /api/jobs and returns the jobId', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test/'
    globalThis.fetch = vi.fn(() => jsonResponse(
      { jobId: 'abc-123', state: 'pending', deadlineMs: 30000 },
      { ok: true, status: 202 }
    ))

    const result = await enqueueMultiRuntimeJob('x+1', { runtimes: ['node'] })

    expect(result.jobId).toBe('abc-123')
    expect(result.deadlineMs).toBe(30000)

    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('http://worker.test/api/jobs')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.code).toBe('x+1')
    expect(body.runtimes).toEqual(['node'])
    expect(body.isAsync).toBe(false)
    expect(body.profiles).toEqual([
      { label: '1x', resourceLevel: 1, cpus: 1, memMb: 512 },
    ])
  })

  it('forwards async benchmark metadata', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test/'
    globalThis.fetch = vi.fn(() => jsonResponse({ jobId: 'abc-123' }, { ok: true, status: 202 }))

    await enqueueMultiRuntimeJob('await Promise.resolve()', { isAsync: true })

    const [, init] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(init.body).isAsync).toBe(true)
  })

  it('forwards versioned runtime targets', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test/'
    globalThis.fetch = vi.fn(() => jsonResponse({ jobId: 'abc-123' }, { ok: true, status: 202 }))

    await enqueueMultiRuntimeJob('x+1', {
      runtimes: ['node@22', { runtime: 'bun', version: '1.3.0' }],
    })

    const [, init] = globalThis.fetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.runtimes).toEqual(['node@22', { runtime: 'bun', version: '1.3.0' }])
  })

  it('sends the bearer token when BENCHMARK_WORKER_SECRET is set', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    process.env.BENCHMARK_WORKER_SECRET = 'topsecret'
    globalThis.fetch = vi.fn(() => jsonResponse({ jobId: 'x' }, { status: 202 }))

    await enqueueMultiRuntimeJob('1+1')

    const [, init] = globalThis.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer topsecret')
  })

  it('returns { unavailable } on non-2xx response', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => jsonResponse(
      { error: 'bad gateway' },
      { ok: false, status: 502 }
    ))

    const result = await enqueueMultiRuntimeJob('1+1')
    expect(result.unavailable).toBe(true)
    expect(result.error).toContain('502')
  })

  it('returns { unavailable } when fetch throws', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('connect ECONNREFUSED')))

    const result = await enqueueMultiRuntimeJob('1+1')
    expect(result.unavailable).toBe(true)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })

  it('returns { unavailable } when worker omits jobId', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => jsonResponse({ state: 'pending' }, { status: 202 }))

    const result = await enqueueMultiRuntimeJob('1+1')
    expect(result.unavailable).toBe(true)
    expect(result.error).toMatch(/missing jobId/)
  })

  it('propagates AbortError instead of swallowing it', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    await expect(
      enqueueMultiRuntimeJob('1+1', { signal: new AbortController().signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('getMultiRuntimeJob', () => {
  it('returns null when BENCHMARK_WORKER_URL is unset', async () => {
    globalThis.fetch = vi.fn()
    expect(await getMultiRuntimeJob('abc')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns null when jobId is empty', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn()
    expect(await getMultiRuntimeJob('')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns the job body on 200', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => jsonResponse({
      jobId: 'abc',
      state: 'done',
      result: { runtimes: { node: { profiles: [], avgOpsPerSec: 0 } } },
    }))

    const job = await getMultiRuntimeJob('abc')
    expect(job.state).toBe('done')
    expect(job.result.runtimes.node).toBeDefined()
  })

  it('returns null on 404 (job evicted from worker memory)', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => jsonResponse({ error: 'not found' }, { ok: false, status: 404 }))

    expect(await getMultiRuntimeJob('gone')).toBeNull()
  })

  it('returns { unavailable } on other non-2xx', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'
    globalThis.fetch = vi.fn(() => jsonResponse({ error: 'oops' }, { ok: false, status: 500 }))

    const job = await getMultiRuntimeJob('abc')
    expect(job.unavailable).toBe(true)
    expect(job.error).toContain('500')
  })

  it('encodes the jobId into the URL', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test/'
    globalThis.fetch = vi.fn(() => jsonResponse({ state: 'pending' }))

    await getMultiRuntimeJob('weird/id?with=stuff')

    const [url] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('http://worker.test/api/jobs/weird%2Fid%3Fwith%3Dstuff')
  })
})
