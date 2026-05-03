import { describe, expect, it } from 'vitest'

import { __testing } from '../../worker/docker.js'

describe('worker docker JIT capture helpers', () => {
  it('adds V8 optimized-code flags for Node and Deno captures', () => {
    expect(__testing.nodeJitFlags()).toEqual(expect.arrayContaining([
      '--no-concurrent-recompilation',
      '--trace-opt',
      '--trace-deopt',
      '--print-opt-code',
      '--print-opt-code-filter=jsperfUserBenchmark',
      '--print-opt-source',
      '--code-comments',
      '--print-code-verbose',
      '--log-code',
      '--logfile=/work/v8.log',
    ]))
    expect(__testing.denoV8Flags({ v8Jit: true })).toContain('--print-opt-code')
    expect(__testing.denoV8Flags({ v8Jit: true })).toContain('--print-opt-source')
    expect(__testing.denoV8Flags({ v8Jit: true })).toContain('--print-opt-code-filter=jsperfUserBenchmark')
    expect(__testing.denoV8Flags({ v8Jit: true })).toContain('--log-code')
    expect(__testing.denoV8Flags({ v8Jit: false })).toBe('--expose-gc')
  })

  it('parses the benchmark JSON even when V8 diagnostics surround it', () => {
    const parsed = __testing.parseStdoutResult([
      '[marking 0x123 <JSFunction jsperfUserBenchmark> for optimization]',
      '{"state":"completed","opsPerSec":1234,"latency":null,"memory":null}',
      '[completed optimizing 0x123 <JSFunction jsperfUserBenchmark>]',
    ].join('\n'))

    expect(parsed.result).toMatchObject({
      state: 'completed',
      opsPerSec: 1234,
    })
  })

  it('parses benchmark JSON embedded in a noisy V8 stdout line', () => {
    const parsed = __testing.parseStdoutResult([
      '[completed optimizing 0x123 <JSFunction jsperfUserBenchmark>]{"state":"completed","opsPerSec":2468,"latency":null,"memory":{"before":null,"after":null}}',
      '[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing 0x123]',
    ].join('\n'))

    expect(parsed.result).toMatchObject({
      state: 'completed',
      opsPerSec: 2468,
    })
  })

  it('tracks benchmark JSON before a large trailing V8 diagnostic stream', () => {
    const tracker = __testing.createStdoutResultTracker()
    tracker.push('[marking 0x123 <JSFunction jsperfUserBenchmark> for optimization]\n')
    tracker.push('{"state":"completed","opsPer')
    tracker.push('Sec":4321,"latency":null,"memory":null}\n')
    tracker.push('{"diagnostic":"not the benchmark result"}\n')
    tracker.push(`${'--- Optimized code ---\n'.repeat(20_000)}\n`)

    const parsed = tracker.finish()
    expect(parsed.result).toMatchObject({
      state: 'completed',
      opsPerSec: 4321,
    })
  })

  it('tracks benchmark JSON appended to a V8 diagnostic chunk', () => {
    const tracker = __testing.createStdoutResultTracker()
    tracker.push('[completed optimizing 0x123 <JSFunction jsperfUserBenchmark>]')
    tracker.push('{"state":"completed","opsPerSec":5678,"latency":null,"memory":null}\n')
    tracker.push('[bailout (kind: deopt-eager, reason: wrong map)]\n')

    const parsed = tracker.finish()
    expect(parsed.result).toMatchObject({
      state: 'completed',
      opsPerSec: 5678,
    })
  })

  it('strips benchmark JSON lines from captured JIT text', () => {
    const output = __testing.stripJsonResultLines([
      '--- Optimized code ---',
      'mov rax, rbx',
      '{"state":"completed","opsPerSec":1234,"latency":null,"memory":null}',
      'ret',
    ].join('\n'))

    expect(output).toBe('--- Optimized code ---\nmov rax, rbx\nret')
  })

  it('strips embedded benchmark JSON from captured JIT text', () => {
    const output = __testing.stripJsonResultLines([
      '--- Optimized code ---',
      '[trace-opt]{"state":"completed","opsPerSec":1234,"latency":null,"memory":null}[trace-deopt]',
      'ret',
    ].join('\n'))

    expect(output).toBe('--- Optimized code ---\n[trace-opt][trace-deopt]\nret')
  })

  it('builds a text artifact from stdout and stderr diagnostics', () => {
    const artifact = __testing.buildJitArtifact({
      stdout: 'mov rax, rbx',
      stderr: '[trace-opt]',
      runtimeName: 'node',
      truncated: true,
    })

    expect(artifact).toMatchObject({
      output: 'mov rax, rbx\n\n[trace-opt]',
      captureMode: 'v8-opt-code',
      source: 'node-v8',
      truncated: true,
    })
  })
})
