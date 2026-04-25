import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateComplexitiesOnWorker } from '../../lib/engines/complexity'

const ORIG_WORKER_URL = process.env.BENCHMARK_WORKER_URL
const ORIG_WORKER_SECRET = process.env.BENCHMARK_WORKER_SECRET
const ORIG_FETCH = globalThis.fetch

describe('estimateComplexitiesOnWorker', () => {
  beforeEach(() => {
    process.env.BENCHMARK_WORKER_URL = 'https://worker.example'
    process.env.BENCHMARK_WORKER_SECRET = 'secret'
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    if (ORIG_WORKER_URL) process.env.BENCHMARK_WORKER_URL = ORIG_WORKER_URL
    else delete process.env.BENCHMARK_WORKER_URL

    if (ORIG_WORKER_SECRET) process.env.BENCHMARK_WORKER_SECRET = ORIG_WORKER_SECRET
    else delete process.env.BENCHMARK_WORKER_SECRET

    globalThis.fetch = ORIG_FETCH
  })

  it('returns null when no worker is configured', async () => {
    delete process.env.BENCHMARK_WORKER_URL

    await expect(estimateComplexitiesOnWorker([{ code: 'x + 1' }])).resolves.toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('posts tests to the worker complexity endpoint', async () => {
    const complexity = { time: { notation: 'O(1)' }, space: { notation: 'O(1)' } }
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ complexity }] }),
    })

    const result = await estimateComplexitiesOnWorker([{ code: 'x + 1', title: 'test' }], {
      setup: 'const x = 1',
    })

    expect(result).toEqual([complexity])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://worker.example/api/complexity',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret',
        },
        body: JSON.stringify({ tests: [{ code: 'x + 1', title: 'test' }], setup: 'const x = 1' }),
      })
    )
  })

  it('reports worker fetch failures as unavailable', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('connect failed'))

    const result = await estimateComplexitiesOnWorker([{ code: 'x + 1' }])

    expect(result).toMatchObject({
      unavailable: true,
      error: expect.stringContaining('Worker unreachable'),
    })
  })

  it('rethrows abort errors', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    globalThis.fetch.mockRejectedValueOnce(abort)

    await expect(estimateComplexitiesOnWorker([{ code: 'x + 1' }])).rejects.toThrow('aborted')
  })

  it('reports non-ok worker responses as unavailable', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })

    const result = await estimateComplexitiesOnWorker([{ code: 'x + 1' }])

    expect(result).toMatchObject({
      unavailable: true,
      error: expect.stringContaining('Worker error 500: boom'),
    })
  })

  it('reports malformed worker results as unavailable', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const result = await estimateComplexitiesOnWorker([{ code: 'x + 1' }])

    expect(result).toMatchObject({
      unavailable: true,
      error: 'Worker response missing complexity results',
    })
  })
})
