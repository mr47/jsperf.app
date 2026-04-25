/**
 * Sanity tests for the worker's runtime script builders.
 *
 * We can't easily run the generated scripts in CI (they require Docker +
 * the runtime binaries), but we *can* verify each builder produces:
 *   - Syntactically valid JavaScript
 *   - The shared benchmark loop body
 *   - Runtime-specific helpers (memoryUsage, GC trigger, etc.)
 *   - Proper escaping when the user's code contains tricky characters
 */
import { describe, expect, it } from 'vitest'
import vm from 'node:vm'

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

    it('inlines setup and teardown when provided', () => {
      const src = build(baseInput)
      expect(src).toContain('const k = 1;')
      expect(src).toContain('/* cleanup */')
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
})
