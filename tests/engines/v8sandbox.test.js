import { describe, expect, it, vi } from 'vitest'

// Mock @vercel/sandbox for unit tests -- real sandbox requires Vercel credentials
const mockStdoutData = JSON.stringify({
  state: 'completed',
  opsPerSec: 150000,
  iterations: 300000,
  totalMs: 2000,
  latency: { mean: 0.0067, p50: 0.006, p99: 0.01, min: 0.005, max: 0.015, samplesCount: 10 },
  heapUsed: 4194304,
  heapTotal: 8388608,
  externalMemory: 1024,
  heapDelta: 2048,
})

vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn(async () => ({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: vi.fn(async () => mockStdoutData),
        stderr: vi.fn(async () => ''),
      })),
      stop: vi.fn(async () => ({})),
    })),
  },
}))

import { runInV8Sandbox } from '../../lib/engines/v8sandbox'

describe('runInV8Sandbox', () => {
  it('executes code in sandbox and returns valid results', async () => {
    const result = await runInV8Sandbox('var s = 0; for (var i = 0; i < 100; i++) s += i;')

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it('returns opsPerSec, heapUsed, latency fields', async () => {
    const result = await runInV8Sandbox('1 + 1')

    expect(result).toHaveProperty('opsPerSec')
    expect(result).toHaveProperty('heapUsed')
    expect(result).toHaveProperty('latency')
    expect(result.latency).toHaveProperty('mean')
    expect(result.latency).toHaveProperty('p50')
    expect(result.latency).toHaveProperty('p99')
    expect(result.latency).toHaveProperty('samplesCount')
  })

  it('handles code that throws errors', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockResolvedValueOnce({
      writeFiles: vi.fn(async () => {}),
      runCommand: vi.fn(async () => ({
        exitCode: 1,
        stdout: vi.fn(async () => ''),
        stderr: vi.fn(async () => 'ReferenceError: foo is not defined'),
      })),
      stop: vi.fn(async () => ({})),
    })

    const result = await runInV8Sandbox('foo.bar.baz()')
    expect(result.state).toBe('errored')
    expect(result.error).toContain('ReferenceError')
  })

  it('handles sandbox creation failure', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockRejectedValueOnce(new Error('Sandbox quota exceeded'))

    const result = await runInV8Sandbox('1 + 1')
    expect(result.state).toBe('errored')
    expect(result.error).toContain('quota')
  })

  it('passes snapshotId when provided', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()

    await runInV8Sandbox('1 + 1', { snapshotId: 'snap_123' })

    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: 'snapshot', snapshotId: 'snap_123' },
      })
    )
  })

  it('uses node24 runtime when no snapshot', async () => {
    const { Sandbox } = await import('@vercel/sandbox')
    Sandbox.create.mockClear()

    await runInV8Sandbox('1 + 1')

    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'node24',
        networkPolicy: 'deny-all',
      })
    )
  })
})

// Integration test -- only runs when VERCEL_TOKEN is available
describe.skipIf(!process.env.VERCEL_TOKEN)('v8sandbox integration', () => {
  it('runs a real benchmark in a Firecracker microVM', async () => {
    vi.restoreAllMocks()
    const { runInV8Sandbox: realRun } = await import('../../lib/engines/v8sandbox')

    const result = await realRun(
      'var s = 0; for (var i = 0; i < 100; i++) s += i;',
      { timeMs: 1000 }
    )

    expect(result.state).toBe('completed')
    expect(result.opsPerSec).toBeGreaterThan(0)
    expect(result.heapUsed).toBeGreaterThan(0)
  }, 60_000)
})
