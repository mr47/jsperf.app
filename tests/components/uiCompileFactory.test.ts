// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { compileFactory } from '../../components/UI'

describe('compileFactory', () => {
  it('ignores a stale async flag when the snippet is synchronous', () => {
    const { factory, error, actuallyAsync } = compileFactory(
      'let sum = 0;\nfor (const x of input) {\n\tsum += x;\n}',
      'const input = [...Array(100).keys()];',
      '',
      true,
    )

    expect(error).toBeNull()
    expect(actuallyAsync).toBe(false)

    const compiled = factory()
    const result = compiled.test()
    expect(result).toBeUndefined()
  })

  it('keeps legacy deferred async snippets asynchronous', async () => {
    const { factory, error, actuallyAsync } = compileFactory(
      'setTimeout(function() { deferred.resolve() }, 0)',
      '',
      '',
      true,
    )

    expect(error).toBeNull()
    expect(actuallyAsync).toBe(true)

    const compiled = factory()
    await expect(compiled.test()).resolves.toBeUndefined()
  })
})
