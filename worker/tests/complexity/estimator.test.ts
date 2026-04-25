// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { estimateComplexity } from '../../complexity/estimator.js'

describe('estimateComplexity', () => {
  it('reports constant work for straight-line scalar code', () => {
    const result = estimateComplexity('let x = 1; x += 2; Math.max(x, 3)')

    expect(result.time.notation).toBe('O(1)')
    expect(result.space.notation).toBe('O(1)')
    expect(result.async.mode).toBe('none')
  })

  it('detects a dynamic loop as linear time with constant space', () => {
    const result = estimateComplexity('let s = 0; for (let i = 0; i < n; i++) s += i')

    expect(result.time.notation).toBe('O(n)')
    expect(result.space.notation).toBe('O(1)')
    expect(result.signals).toContain('for')
  })

  it('detects nested dynamic loops as quadratic', () => {
    const result = estimateComplexity(`
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < rows[i].length; j++) {
          total += rows[i][j]
        }
      }
    `)

    expect(result.time.notation).toBe('O(n^2)')
  })

  it('recognizes sorting and copying sort helpers', () => {
    const inPlace = estimateComplexity('items.sort((a, b) => a - b)')
    const copied = estimateComplexity('items.toSorted((a, b) => a.score - b.score)')

    expect(inPlace.time.notation).toBe('O(n log n)')
    expect(copied.time.notation).toBe('O(n log n)')
    expect(copied.space.notation).toBe('O(n)')
  })

  it('scores allocation-heavy collection helpers as linear space', () => {
    const result = estimateComplexity('const out = items.map(x => ({ ...x, active: true })).filter(Boolean)')

    expect(result.time.notation).toBe('O(n)')
    expect(result.space.notation).toBe('O(n)')
    expect(result.signals).toContain('map-allocation')
  })

  it('uses setup symbols as context without charging setup work to the test', () => {
    const result = estimateComplexity('cache.get(id)', {
      setup: 'const cache = new Map(items.map(item => [item.id, item]))',
    })

    expect(result.time.notation).toBe('O(1)')
    expect(result.setupContext.symbols).toContain('cache')
    expect(result.setupContext.notes.join(' ')).toContain('setup parsed as context')
  })

  it('marks parser recovery as lower confidence instead of throwing', () => {
    const result = estimateComplexity('if (')

    expect(result.signals).toContain('parser-error')
    expect(result.time.confidence).toBeLessThan(0.7)
  })

  it('tracks single await separately from CPU complexity', () => {
    const result = estimateComplexity('const value = await fetchValue(id); return value + 1')

    expect(result.time.notation).toBe('O(1)')
    expect(result.async.mode).toBe('single-await')
  })

  it('flags sequential awaits inside loops', () => {
    const result = estimateComplexity(`
      for (const item of items) {
        await save(item)
      }
    `)

    expect(result.time.notation).toBe('O(n)')
    expect(result.async.mode).toBe('sequential-await')
    expect(result.signals).toContain('sequential-await-in-loop')
  })

  it('treats for-await and Array.fromAsync as sequential async traversal', () => {
    const loop = estimateComplexity('for await (const item of stream) { total += item.size }')
    const fromAsync = estimateComplexity('const rows = await Array.fromAsync(stream, async row => normalize(row))')

    expect(loop.time.notation).toBe('O(n)')
    expect(loop.async.mode).toBe('async-iteration')
    expect(fromAsync.space.notation).toBe('O(n)')
    expect(fromAsync.async.mode).toBe('async-iteration')
  })

  it('detects Promise fan-out and race scheduling', () => {
    const fanout = estimateComplexity('await Promise.all(items.map(async item => load(item)))')
    const race = estimateComplexity('await Promise.race(items.map(item => load(item)))')

    expect(fanout.async.mode).toBe('parallel-fanout')
    expect(fanout.space.notation).toBe('O(n)')
    expect(race.async.mode).toBe('race')
  })

  it('handles modern copy and serialization helpers', () => {
    const spread = estimateComplexity('const copy = { ...item, tags: [...item.tags] }')
    const entries = estimateComplexity('Object.fromEntries(Object.entries(input).filter(([k]) => k !== "_"))')
    const json = estimateComplexity('const copy = JSON.parse(JSON.stringify(input))')

    expect(spread.space.notation).toBe('O(n)')
    expect(entries.time.notation).toBe('O(n)')
    expect(json.time.notation).toBe('O(n)')
  })

  it('reduces confidence for regex-dependent work', () => {
    const result = estimateComplexity('return /^(a+)+$/.test(value)')

    expect(result.signals).toContain('regex-pattern-dependent')
    expect(result.time.confidence).toBeLessThan(0.9)
  })
})
