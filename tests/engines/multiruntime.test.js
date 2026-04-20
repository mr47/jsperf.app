/**
 * Tests for the multi-runtime engine (jsperf.app side, not the worker side).
 *
 * The engine talks to a remote worker over NDJSON. We mock global fetch so
 * we can exercise the streaming parser, error paths, and the env-var gate
 * without standing up a real worker.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { runMultiRuntime } from '../../lib/engines/multiruntime.js'

function ndjsonResponse(lines, { ok = true, status = 200 } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      for (const line of lines) {
        controller.enqueue(enc.encode(JSON.stringify(line) + '\n'))
      }
      controller.close()
    },
  })
  return Promise.resolve({
    ok,
    status,
    body: stream,
    text: async () => '',
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

describe('runMultiRuntime', () => {
  it('returns null when BENCHMARK_WORKER_URL is unset', async () => {
    globalThis.fetch = vi.fn()
    const result = await runMultiRuntime('1+1')
    expect(result).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('parses streamed result lines into per-runtime profiles', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'

    globalThis.fetch = vi.fn(() => ndjsonResponse([
      { type: 'start' },
      { type: 'progress', runtime: 'node', profile: '1x', status: 'running' },
      {
        type: 'result',
        runtime: 'node',
        profile: '1x',
        resourceLevel: 1,
        cpus: 0.5,
        memMb: 256,
        state: 'completed',
        opsPerSec: 12345,
        latency: { mean: 0.08, p50: 0.07, p99: 0.12 },
        memory: { after: { rss: 50_000_000 } },
        perfCounters: { instructions: 1_000_000_000, cycles: 500_000_000 },
        durationMs: 1100,
      },
      {
        type: 'result',
        runtime: 'bun',
        profile: '1x',
        resourceLevel: 1,
        cpus: 0.5,
        memMb: 256,
        state: 'completed',
        opsPerSec: 67890,
        latency: { mean: 0.014 },
        memory: null,
        perfCounters: null,
        durationMs: 900,
      },
      { type: 'done' },
    ]))

    const progress = []
    const result = await runMultiRuntime('1+1', {
      runtimes: ['node', 'bun'],
      onProgress: (e) => progress.push(e),
    })

    expect(result.runtimes.node.profiles).toHaveLength(1)
    expect(result.runtimes.node.profiles[0].opsPerSec).toBe(12345)
    expect(result.runtimes.node.profiles[0].perfCounters.instructions).toBe(1_000_000_000)
    expect(result.runtimes.node.avgOpsPerSec).toBe(12345)

    expect(result.runtimes.bun.avgOpsPerSec).toBe(67890)

    expect(progress).toContainEqual(
      expect.objectContaining({ runtime: 'node', profile: '1x', status: 'running' })
    )
  })

  it('records first error per runtime and skips it from avg', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'

    globalThis.fetch = vi.fn(() => ndjsonResponse([
      {
        type: 'result',
        runtime: 'deno',
        profile: '1x',
        resourceLevel: 1,
        state: 'errored',
        error: 'boom',
        opsPerSec: 0,
      },
      { type: 'done' },
    ]))

    const result = await runMultiRuntime('1+1', { runtimes: ['deno'] })
    expect(result.runtimes.deno.error).toBe('boom')
    expect(result.runtimes.deno.avgOpsPerSec).toBe(0)
  })

  it('sends the bearer token when BENCHMARK_WORKER_SECRET is set', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test/'
    process.env.BENCHMARK_WORKER_SECRET = 'topsecret'

    globalThis.fetch = vi.fn(() => ndjsonResponse([{ type: 'done' }]))

    await runMultiRuntime('1+1', { runtimes: ['node'] })

    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('http://worker.test/api/run')
    expect(init.headers.Authorization).toBe('Bearer topsecret')
  })

  it('returns { unavailable: true } when worker returns non-2xx', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'

    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 502,
      body: null,
      text: async () => 'bad gateway',
    }))

    const result = await runMultiRuntime('1+1')
    expect(result.unavailable).toBe(true)
    expect(result.error).toContain('502')
  })

  it('returns { unavailable: true } when fetch throws', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'

    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('connect ECONNREFUSED')))

    const result = await runMultiRuntime('1+1')
    expect(result.unavailable).toBe(true)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })

  it('propagates AbortError from fetch instead of swallowing it', async () => {
    process.env.BENCHMARK_WORKER_URL = 'http://worker.test'

    globalThis.fetch = vi.fn(() => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    await expect(runMultiRuntime('1+1', { signal: new AbortController().signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})
