import { describe, expect, it } from 'vitest'

import { __testing } from '../../worker/docker.js'

describe('worker docker JIT capture helpers', () => {
  it('adds V8 optimized-code flags for Node and Deno captures', () => {
    expect(__testing.nodeJitFlags()).toEqual(expect.arrayContaining([
      '--trace-opt',
      '--trace-deopt',
      '--print-opt-code',
      '--print-opt-code-filter=jsperfUserBenchmark',
    ]))
    expect(__testing.denoV8Flags({ v8Jit: true })).toContain('--print-opt-code')
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

  it('strips benchmark JSON lines from captured JIT text', () => {
    const output = __testing.stripJsonResultLines([
      '--- Optimized code ---',
      'mov rax, rbx',
      '{"state":"completed","opsPerSec":1234}',
      'ret',
    ].join('\n'))

    expect(output).toBe('--- Optimized code ---\nmov rax, rbx\nret')
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
