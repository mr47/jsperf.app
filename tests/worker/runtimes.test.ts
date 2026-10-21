// @ts-nocheck
/**
 * Sanity tests for the worker's runtime script builders.
 *
 * Deno and Bun scripts need their runtime binaries, so for those we only
 * verify each builder produces (the Node script is also executed with the
 * test runner's own node binary):
 *   - Syntactically valid JavaScript
 *   - The shared benchmark loop body
 *   - Runtime-specific helpers (memoryUsage, GC trigger, etc.)
 *   - Proper escaping when the user's code contains tricky characters
 */
import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildNodeScript } from '../../worker/runtimes/node.js'
import { buildDenoScript } from '../../worker/runtimes/deno.js'
import { buildBunScript } from '../../worker/runtimes/bun.js'

const baseInput = {
  code: 'Math.sqrt(123)',
  setup: 'const k = 1;',
  teardown: '/* cleanup */',
  timeMs: 1000,
}

describe('runtime script builders', () => {
  describe.each([
    ['node', buildNodeScript],
    ['deno', buildDenoScript],
    ['bun', buildBunScript],
  ])('%s', (name, build) => {
    it('produces syntactically valid JavaScript', () => {
      const src = build(baseInput)
      // vm.Script throws SyntaxError on invalid JS; we don't run the script.
      expect(() => new vm.Script(src)).not.toThrow()
    })

    it('embeds the shared benchmark loop and result emitter', () => {
      const src = build(baseInput)
      expect(src).toContain('function runBenchmark()')
      expect(src).toContain('emitResult(')
      expect(src).toContain('TIME_LIMIT = 1000')
      expect(src).toContain('computeBenchmarkStats(')
    })

    it('embeds setup and teardown when provided', () => {
      const src = build(baseInput)
      expect(src).toContain('const k = 1;')
      expect(src).toContain('/* cleanup */')
    })

    it.each([
      ['a syntax error', 'const arr = [1, 2, 3'],
      ['module syntax', "import fs from 'fs'"],
      ['a declaration that shadows a harness name', 'let runBenchmark = 1; let emitResult = 2;'],
    ])('stays parseable when setup contains %s', (_label, setup) => {
      const src = build({ ...baseInput, setup })
      expect(() => new vm.Script(src)).not.toThrow()
    })

    it('stays parseable when teardown contains a syntax error', () => {
      const src = build({ ...baseInput, teardown: 'x = {' })
      expect(() => new vm.Script(src)).not.toThrow()
    })

    it('omits the teardown block cleanly when not provided', () => {
      const src = build({ ...baseInput, teardown: undefined })
      expect(() => new vm.Script(src)).not.toThrow()
    })

    it('safely escapes user code containing quotes and backslashes', () => {
      const trickyCode = `const s = "hello \\" world"; const re = /\\d+/g;`
      const src = build({ ...baseInput, code: trickyCode })
      // The builder JSON-encodes the code, so the literal must appear in
      // its escaped form somewhere in the output and the script must still
      // parse as valid JavaScript.
      expect(() => new vm.Script(src)).not.toThrow()
      expect(src).toContain(JSON.stringify(trickyCode))
    })

    it('errors are routed through __emitError instead of crashing silently', () => {
      const src = build(baseInput)
      expect(src).toContain('__emitError')
    })

    it('awaits async benchmark snippets when requested', () => {
      const src = build({ ...baseInput, code: 'await Promise.resolve(1)', isAsync: true })
      expect(() => new vm.Script(src)).not.toThrow()
      expect(src).toContain('const IS_ASYNC = true')
      expect(src).toContain('const __benchPrefix = "async "')
      expect(src).toContain('await __benchFn()')
    })
  })

  it('node script uses --expose-gc compatible gc()', () => {
    const src = buildNodeScript(baseInput)
    expect(src).toContain("typeof gc === 'function'")
    expect(src).toContain("require('v8')")
  })

  it('node script can capture a DevTools CPU profile when requested', () => {
    const src = buildNodeScript({ ...baseInput, profiling: { nodeCpu: true } })
    expect(() => new vm.Script(src)).not.toThrow()
    expect(src).toContain('const ENABLE_CPU_PROFILE = true')
    expect(src).toContain("require('node:inspector')")
      expect(src).toContain('function jsperfUserBenchmark()')
      expect(src).toContain('sourceURL=jsperf-user-code.js')
    expect(src).toContain('const __benchSource =')
    expect(src).toContain('profile._scripts = buildCpuProfileScripts(profile, benchmarkSource)')
    expect(src).toContain("'Profiler.start'")
    expect(src).toContain("'Profiler.stop'")
    expect(src).toContain('cpuProfileMeta')
  })

  describe('node script execution', () => {
    function runNodeScript(input) {
      const dir = mkdtempSync(join(tmpdir(), 'jsperf-runtime-test-'))
      try {
        const file = join(dir, 'bench.js')
        writeFileSync(file, buildNodeScript({ timeMs: 20, ...input }))
        const child = spawnSync(process.execPath, ['--expose-gc', file], { encoding: 'utf8' })
        const lines = child.stdout.trim().split('\n').filter(Boolean)
        return {
          status: child.status,
          stderr: child.stderr,
          result: lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null,
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it('reports a setup syntax error as a structured result', () => {
      const run = runNodeScript({ setup: 'const arr = [1, 2, 3', code: 'arr.length' })
      expect(run.status).toBe(1)
      expect(run.stderr).toBe('')
      expect(run.result).toMatchObject({ state: 'errored', opsPerSec: 0 })
      expect(run.result.error).toMatch(/^Setup code failed to parse: /)
    })

    it('reports module syntax in setup as a structured result', () => {
      const run = runNodeScript({ setup: "import fs from 'fs'", code: '1 + 1' })
      expect(run.result).toMatchObject({ state: 'errored' })
      expect(run.result.error).toContain('Setup code failed to parse')
    })

    it('lets setup declare names the harness also uses', () => {
      const run = runNodeScript({ setup: 'let runBenchmark = 1; let emitResult = 2;', code: 'runBenchmark + emitResult' })
      expect(run.status).toBe(0)
      expect(run.result).toMatchObject({ state: 'completed' })
    })

    it('shares setup scope with the test and teardown, including await', () => {
      const run = runNodeScript({
        setup: 'const items = await Promise.resolve([1, 2, 3]);',
        code: 'return items.length',
        teardown: 'await null; console.error("teardown:" + items.length)',
      })
      expect(run.result).toMatchObject({ state: 'completed' })
      expect(run.stderr).toContain('teardown:3')
    })

    it('treats a broken teardown as non-fatal', () => {
      const run = runNodeScript({ setup: '', code: '1 + 1', teardown: 'x = {' })
      expect(run.status).toBe(0)
      expect(run.result).toMatchObject({ state: 'completed' })
    })

    it.each([
      ['delete of an identifier in teardown', { setup: 'var b = { x: 1 };', code: 'b.x + 1', teardown: 'delete b; console.error("teardown ran")' }],
      ['delete of an identifier in setup', { setup: 'a = 1; delete a;', code: '1 + 1' }],
      ['a with statement in the test', { setup: 'var o = { v: 2 };', code: 'with (o) { v * 2 }' }],
      ['sloppy this in setup', { setup: 'if (this !== globalThis) throw new Error("strict");', code: '1 + 1' }],
    ])('runs user code in sloppy mode like the browser engine: %s', (_label, input) => {
      const run = runNodeScript(input)
      expect(run.result).toMatchObject({ state: 'completed' })
      if (input.teardown) expect(run.stderr).toContain('teardown ran')
    })

    it('exposes the CommonJS require to setup and lets setup shadow it', () => {
      expect(runNodeScript({ setup: "const crypto = require('crypto');", code: 'crypto.randomBytes(4)' }).result)
        .toMatchObject({ state: 'completed' })
      expect(runNodeScript({ setup: 'const require = 5;', code: 'return require + 1' }).result)
        .toMatchObject({ state: 'completed' })
    })

    it('reports a setup that returns early instead of exiting silently', () => {
      const run = runNodeScript({ setup: 'return', code: '1 + 1' })
      expect(run.result).toMatchObject({
        state: 'errored',
        error: 'Setup code returned before the benchmark could start',
      })
    })

    it('still reports runtime errors thrown by setup', () => {
      const run = runNodeScript({ setup: 'throw new Error("boom in setup")', code: '1 + 1' })
      expect(run.result).toMatchObject({ state: 'errored', error: 'boom in setup' })
    })
  })

  it('deno script uses Deno.memoryUsage and Deno.stdout.writeSync', () => {
    const src = buildDenoScript(baseInput)
    expect(src).toContain('Deno.memoryUsage()')
    expect(src).toContain('Deno.stdout.writeSync')
  })

  it('bun script triggers Bun.gc and pulls JSC heap stats', () => {
    const src = buildBunScript(baseInput)
    expect(src).toContain('Bun.gc(true)')
    expect(src).toContain("import('bun:jsc')")
  })

  it('deno can emit a native TypeScript script', () => {
    const script = buildDenoScript({
      ...baseInput,
      code: 'const value: number = 1\nreturn value',
      nativeTypeScript: true,
    })

    expect(script.extension).toBe('ts')
    expect(script.source).toContain('const __benchFn = function()')
    expect(script.source).toContain('const value: number = 1')
    expect(script.source).not.toContain('eval(')
  })

  it('bun can emit a native TypeScript script', () => {
    const script = buildBunScript({
      ...baseInput,
      code: 'const value: number = 1\nreturn value',
      nativeTypeScript: true,
    })

    expect(script.extension).toBe('ts')
    expect(script.source).toContain('const __benchFn = function()')
    expect(script.source).toContain('const value: number = 1')
    expect(script.source).not.toContain('eval(')
  })
})
