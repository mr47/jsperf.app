import { describe, expect, it } from 'vitest'

import { __testing, buildDockerRunArgs } from '../../worker/docker.js'

describe('worker docker JIT capture helpers', () => {
  it('adds V8 optimized-code flags only for Node captures', () => {
    expect(__testing.nodeJitFlags()).toEqual(expect.arrayContaining([
      '--no-maglev',
      '--no-concurrent-recompilation',
      '--trace-opt',
      '--trace-deopt',
      '--print-opt-code',
      '--print-opt-code-filter=jsperfUserBenchmark',
      '--print-opt-source',
      '--code-comments',
      '--print-code-verbose',
    ]))
    // V8 log files are per-isolate (isolate-<addr>-<pid>-v8.log) and /work
    // is read-only, so nothing may ask V8 to write a log file.
    expect(__testing.nodeJitFlags().some((flag: string) => flag.startsWith('--logfile'))).toBe(false)
    expect(__testing.nodeJitFlags()).not.toContain('--log-code')
    expect(__testing.denoV8Flags({ v8Jit: true })).toBe('--expose-gc')
    expect(__testing.denoV8Flags({ v8Jit: false })).toBe('--expose-gc')
    expect(__testing.shouldCaptureJitRuntime('node')).toBe(true)
    expect(__testing.shouldCaptureJitRuntime('deno')).toBe(false)
    expect(__testing.shouldCaptureJitRuntime('bun')).toBe(false)
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
      stdout: [
        '--- Raw source ---',
        '() { return value }',
        '',
        '--- Optimized code ---',
        'Instructions (size = 16)',
        '0x1  0  55  push rbp',
      ].join('\n'),
      stderr: '[trace-opt]',
      runtimeName: 'node',
      truncated: true,
    })

    expect(artifact).toMatchObject({
      captureMode: 'v8-opt-code',
      source: 'node-v8',
      truncated: true,
    })
    expect(artifact?.output).toContain('--- Optimized code ---')
    expect(artifact?.output).toContain('[trace-opt]')
  })

  it('does not build viewer artifacts from trace-only Maglev output', () => {
    const artifact = __testing.buildJitArtifact({
      stdout: '[completed compiling 0x123 <JSFunction jsperfUserBenchmark> (target MAGLEV)]',
      stderr: '',
      runtimeName: 'node',
      truncated: false,
    })

    expect(artifact).toBeNull()
    expect(__testing.jitCaptureMissingReason({
      stdout: '[completed compiling 0x123 <JSFunction jsperfUserBenchmark> (target MAGLEV)]',
      stderr: '',
    })).toContain('Maglev only')
  })
})

describe('worker docker run sandbox', () => {
  const baseArgs = {
    containerName: 'bench-node-1x-abc12345',
    image: 'jsperf-bench-node:latest',
    workDir: '/tmp/jsperf-worker/bench-node-XYZ',
    profile: { label: '1x', cpus: 1, memMb: 512 },
    innerCmd: ['node', '--expose-gc', '/work/bench.js'],
  }

  function flagValue(args: string[], flag: string) {
    const idx = args.indexOf(flag)
    return idx === -1 ? undefined : args[idx + 1]
  }

  function flagValues(args: string[], flag: string) {
    return args.flatMap((arg, idx) => (arg === flag ? [args[idx + 1]] : []))
  }

  it('mounts the script read-only and leaves no writable host path', () => {
    const args = buildDockerRunArgs({ ...baseArgs, usePerf: false })
    const mounts = flagValues(args, '-v')
    expect(mounts).toEqual([`${baseArgs.workDir}:/work:ro`])
    expect(args).toContain('--read-only')
    expect(flagValue(args, '--tmpfs')).toMatch(/^\/tmp:size=\d+m/)
    expect(args.some((arg) => /:rw$/.test(arg))).toBe(false)
  })

  it('drops every capability, isolates network and ipc, and runs unprivileged', () => {
    const args = buildDockerRunArgs({ ...baseArgs, usePerf: false })
    expect(flagValue(args, '--network')).toBe('none')
    expect(flagValue(args, '--ipc')).toBe('none')
    expect(flagValue(args, '--cap-drop')).toBe('ALL')
    expect(args).not.toContain('--cap-add')
    expect(flagValue(args, '--security-opt')).toBe('no-new-privileges')
    expect(flagValue(args, '--user')).toBe('65534:65534')
    expect(flagValue(args, '--pids-limit')).toBe('256')
    expect(flagValue(args, '--ulimit')).toBe('nofile=256:256')
    expect(flagValue(args, '--memory')).toBe('512m')
    expect(flagValue(args, '--memory-swap')).toBe('512m')
    expect(flagValue(args, '--cpus')).toBe('1')
  })

  it('only grants the two perf capabilities (and root) when perf counters are requested', () => {
    const args = buildDockerRunArgs({ ...baseArgs, usePerf: true, innerCmd: ['perf', 'stat', '--', 'node', '/work/bench.js'] })
    expect(flagValue(args, '--cap-drop')).toBe('ALL')
    expect(flagValues(args, '--cap-add').sort()).toEqual(['PERFMON', 'SYS_PTRACE'])
    expect(flagValue(args, '--user')).toBe('0:0')
    expect(flagValues(args, '-v')).toEqual([`${baseArgs.workDir}:/work:ro`])
  })

  it('labels the container so the reaper can find it and keeps --rm', () => {
    const args = buildDockerRunArgs({ ...baseArgs, usePerf: false })
    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(flagValue(args, '--name')).toBe(baseArgs.containerName)
    expect(flagValues(args, '--label')).toContain('jsperf.worker=1')
    expect(args.slice(-4)).toEqual([baseArgs.image, 'node', '--expose-gc', '/work/bench.js'])
  })

  it('points runtime caches at the tmpfs so an arbitrary uid works', () => {
    const args = buildDockerRunArgs({ ...baseArgs, usePerf: false })
    const env = flagValues(args, '-e')
    expect(env).toContain('HOME=/tmp')
    expect(env).toContain('DENO_DIR=/tmp/.deno')
    expect(env).toContain('BUN_INSTALL=/tmp/.bun')
  })
})

describe('worker docker output handling', () => {
  it('parses perf stat CSV from the stderr tail and ignores runtime noise', () => {
    const stderr = [
      'Warning: something the runtime printed',
      '(node:1) ExperimentalWarning: foo',
      '',
      '12345678,,instructions,1234567,100.00,,',
      '2345678,,cycles,1234567,100.00,,',
      '<not supported>,,cache-misses,0,100.00,,',
      '<not counted>,,branch-misses,0,0.00,,',
      '321,,page-faults,1234567,100.00,,',
      '12,,context-switches,1234567,100.00,,',
    ].join('\n')

    expect(__testing.parsePerfStderr(stderr)).toEqual({
      instructions: 12345678,
      cycles: 2345678,
      'cache-misses': null,
      'branch-misses': null,
      'page-faults': 321,
      'context-switches': 12,
    })
  })

  it('does not let a snippet inject counters via CSV-shaped stderr lines', () => {
    const stderr = [
      '999,,evil-counter,1,100.00,,',
      '1,,instructions,1,100.00,,',
    ].join('\n')
    expect(__testing.parsePerfStderr(stderr)).toEqual({ instructions: 1 })
    expect(__testing.parsePerfStderr('')).toBeNull()
    expect(__testing.parsePerfStderr('no perf here')).toBeNull()
  })

  it('bounds captured output to a fixed tail', () => {
    let tail = ''
    for (let i = 0; i < 1000; i++) tail = __testing.appendTail(tail, 'x'.repeat(1024), 4096)
    expect(Buffer.byteLength(tail)).toBe(4096)

    const head = __testing.appendHead('a'.repeat(10), 'b'.repeat(10), 15)
    expect(head).toEqual({ value: 'a'.repeat(10) + 'b'.repeat(5), truncated: true })
  })

  it('still finds the result JSON when stdout is flooded before and after it', () => {
    const tracker = __testing.createStdoutResultTracker()
    tracker.push(`${'noise\n'.repeat(50_000)}`)
    tracker.push('{"state":"completed","opsPerSec":42,"latency":null,"memory":null}\n')
    tracker.push(`${'more noise\n'.repeat(50_000)}`)
    expect(tracker.finish().result).toMatchObject({ state: 'completed', opsPerSec: 42 })
  })
})
