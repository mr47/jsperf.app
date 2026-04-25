import { describe, expect, it } from 'vitest'
import {
  findBrowserApiGlobals,
  findBrowserApiUsage,
  isAsyncTest,
  testUsesBrowserApis,
} from '../../lib/benchmark/detection.js'

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
})
