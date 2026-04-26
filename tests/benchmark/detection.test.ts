import { describe, expect, it } from 'vitest'
import {
  findAsyncNotAwaitedRisk,
  findBrowserApiGlobals,
  findBrowserApiUsage,
  findConstantFoldingRisk,
  findDeadCodeEliminationRisk,
  findSetupInMeasuredCodeRisk,
  isAsyncTest,
  testUsesBrowserApis,
} from '../../lib/benchmark/detection'

describe('benchmark detection', () => {
  it('detects async benchmark snippets', () => {
    expect(isAsyncTest({ code: 'await Promise.resolve(1)' })).toBe(true)
    expect(isAsyncTest({ code: 'deferred.resolve(value)' })).toBe(true)
    expect(isAsyncTest({ code: 'return new Promise(resolve => resolve())' })).toBe(true)
    expect(isAsyncTest({ code: 'x + 1', runtimeCode: 'await Promise.resolve(1)' })).toBe(true)
    expect(isAsyncTest({ code: 'x + 1', originalCode: 'await Promise.resolve(1)' })).toBe(true)
    expect(isAsyncTest({ code: 'x + 1' })).toBe(false)
  })

  it('detects browser globals in test code', () => {
    const usage = findBrowserApiUsage({
      code: 'const el = document.createElement("div"); window.requestAnimationFrame(() => el.remove())',
    })

    expect(usage).toEqual(expect.arrayContaining(['document', 'window']))
    expect(testUsesBrowserApis({ code: 'localStorage.getItem("key")' })).toBe(true)
    expect(testUsesBrowserApis({ code: 'x + 1', originalCode: 'document.body' })).toBe(true)
  })

  it('detects browser globals in shared setup and teardown', () => {
    const usage = findBrowserApiUsage(
      { code: 'value + 1' },
      {
        setup: 'const root = document.querySelector("#app")',
        teardown: 'cancelAnimationFrame(frameId)',
      }
    )

    expect(usage).toEqual(expect.arrayContaining(['cancelAnimationFrame', 'document']))
  })

  it('ignores browser-looking words in strings and comments', () => {
    expect(findBrowserApiGlobals(`
      // document.createElement should not count here
      const label = "window.localStorage";
      const item = { document: true };
    `)).toEqual([])
  })

  it('detects Promise-like work that the harness may not await', () => {
    expect(findAsyncNotAwaitedRisk({ code: 'return Promise.resolve(value)' })).toMatchObject({
      evidence: expect.stringContaining('Promise.resolve'),
    })
    expect(findAsyncNotAwaitedRisk({ code: 'await Promise.resolve(value)' })).toBeNull()
    expect(findAsyncNotAwaitedRisk({ code: 'return new Promise(resolve => resolve(value))' })).toBeNull()
  })

  it('detects dead-code elimination risk for unused computed values', () => {
    expect(findDeadCodeEliminationRisk({ code: 'items.map(item => item.id)' })).toMatchObject({
      evidence: expect.stringContaining('items.map'),
    })
    expect(findDeadCodeEliminationRisk({ code: 'return items.map(item => item.id)' })).toBeNull()
    expect(findDeadCodeEliminationRisk({ code: 'sink = items.map(item => item.id)' })).toBeNull()
  })

  it('detects constant folding risk for literal-only work', () => {
    expect(findConstantFoldingRisk({ code: 'return 2 * (10 + 5)' })).toMatchObject({
      evidence: expect.stringContaining('2 *'),
    })
    expect(findConstantFoldingRisk({ code: 'return Math.max(1, 2)' })).toMatchObject({
      evidence: expect.stringContaining('Math.max'),
    })
    expect(findConstantFoldingRisk({ code: 'return Math.max(value, 2)' })).toBeNull()
  })

  it('detects setup-looking work inside measured snippets', () => {
    expect(findSetupInMeasuredCodeRisk({ code: 'const data = Array.from({ length: 1000 }, (_, i) => i)\nreturn data.includes(999)' })).toMatchObject({
      evidence: expect.stringContaining('Array.from'),
    })
    expect(findSetupInMeasuredCodeRisk({ code: 'return values.includes(999)' })).toBeNull()
  })
})
