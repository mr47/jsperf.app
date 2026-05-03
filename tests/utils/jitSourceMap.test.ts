import { describe, expect, it } from 'vitest'

import { parseOptimizedBlocks } from '../../utils/jitSourceMap'

describe('parseOptimizedBlocks', () => {
  it('maps V8 source_position to the nearest AST construct in the raw source block', () => {
    const output = [
      '--- Raw source ---',
      '() {',
      'const c = [...a, ...b]',
      '})',
      '',
      '--- Optimized code ---',
      'optimization_id = 2',
      'source_position = 18',
      'kind = TURBOFAN_JS',
      'name = jsperfUserBenchmark',
      'compiler = turbofan',
      '',
      'Instructions (size = 128)',
      '0x1  0  55  push rbp',
    ].join('\n')

    const blocks = parseOptimizedBlocks(output)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      optimizationId: '2',
      sourcePosition: '18',
      mappedSourcePosition: 13,
      kind: 'TURBOFAN_JS',
      name: 'jsperfUserBenchmark',
      compiler: 'turbofan',
      instructionSize: '128',
    })
    expect(blocks[0].source).toBe('const c = [...a, ...b]')
    expect(blocks[0].optimizedBody).toBe('Instructions (size = 128)\n0x1  0  55  push rbp')
    expect(blocks[0].astMatch?.label).toBe('spread element')
    expect(blocks[0].astMatch?.snippet).toBe('...a')
    expect(blocks[0].hasPreciseSourceMap).toBe(false)
  })

  it('falls back to a representative AST node when source position is unavailable', () => {
    const output = [
      '--- Raw source ---',
      '() {',
      'return value + 1',
      '})',
      '',
      '--- Optimized code ---',
      'name = jsperfUserBenchmark',
      'Instructions (size = 64)',
      '0x1  0  55  push rbp',
    ].join('\n')

    const [block] = parseOptimizedBlocks(output)

    expect(block.astMatch?.label).toBe('return statement')
    expect(block.astMatch?.snippet).toContain('return value + 1')
  })

  it('parses adjacent optimized-code blocks', () => {
    const output = [
      '--- Raw source ---',
      '() {',
      'return a',
      '})',
      '',
      '--- Optimized code ---',
      'name = first',
      'Instructions (size = 8)',
      '0x1  0  55  push rbp',
      '',
      '--- Raw source ---',
      '() {',
      'return b',
      '})',
      '',
      '--- Optimized code ---',
      'name = second',
      'Instructions (size = 8)',
      '0x2  0  c3  ret',
    ].join('\n')

    const blocks = parseOptimizedBlocks(output)

    expect(blocks).toHaveLength(2)
    expect(blocks.map(block => block.name)).toEqual(['first', 'second'])
  })

  it('builds source-linked assembly ranges from V8 source positions', () => {
    const rawSource = '(a,b){ const c=[...a,...b]; return c.length }'
    const functionStart = 28
    const bodyStart = rawSource.indexOf('const c')
    const returnStart = rawSource.indexOf('return')
    const output = [
      `--- FUNCTION SOURCE ([eval]:jsperfUserBenchmark) id{4,-1} start{${functionStart}} ---`,
      rawSource,
      '--- END ---',
      '--- Raw source ---',
      rawSource,
      '',
      '--- Optimized code ---',
      'optimization_id = 4',
      `source_position = ${functionStart}`,
      'kind = TURBOFAN_JS',
      'name = jsperfUserBenchmark',
      'compiler = turbofan',
      '',
      'Instructions (size = 32)',
      '0x1000     0  55             push rbp',
      '0x1004     4  4889e5         mov rbp,rsp',
      '0x1008     8  c3             ret',
      '',
      'Source positions:',
      ' pc offset  position',
      `        0        ${functionStart + bodyStart}`,
      `        8        ${functionStart + returnStart}`,
      '',
      'Inlined functions (count = 0)',
      '',
      '--- End code ---',
    ].join('\n')

    const [block] = parseOptimizedBlocks(output)

    expect(block.source).toBe('const c=[...a,...b]; return c.length')
    expect(block.functionSourceStart).toBe(functionStart)
    expect(block.sourcePositions).toEqual([
      expect.objectContaining({ pcOffset: 0, sourcePosition: functionStart + bodyStart, mappedSourcePosition: 0 }),
      expect.objectContaining({ pcOffset: 8, sourcePosition: functionStart + returnStart, mappedSourcePosition: returnStart - bodyStart }),
    ])
    expect(block.hasPreciseSourceMap).toBe(true)
    expect(block.mappedRanges).toHaveLength(2)
    expect(block.mappedRanges[0]).toMatchObject({
      pcOffset: 0,
      pcOffsetHex: '0',
      mappedSourcePosition: 0,
      instructionCount: 2,
    })
    expect(block.mappedRanges[0].sourceSnippet).toBe('const c=[...a,...b];')
    expect(block.mappedRanges[0].instructions).toContain('push rbp')
    expect(block.mappedRanges[1]).toMatchObject({
      pcOffset: 8,
      pcOffsetHex: '8',
      instructionCount: 1,
    })
    expect(block.mappedRanges[1].sourceSnippet).toBe('return c.length')
    expect(block.mappedRanges[1].instructions).toContain('ret')
  })

  it('merges adjacent pc ranges that point at the same source span', () => {
    const rawSource = '(a,b){ const c=[...a,...b] }'
    const functionStart = 10
    const bodyStart = rawSource.indexOf('const c')
    const output = [
      `--- FUNCTION SOURCE ([eval]:jsperfUserBenchmark) id{4,-1} start{${functionStart}} ---`,
      rawSource,
      '--- END ---',
      '--- Raw source ---',
      rawSource,
      '',
      '--- Optimized code ---',
      'name = jsperfUserBenchmark',
      'Instructions (size = 32)',
      '0x1000     0  55             push rbp',
      '0x1004     4  4889e5         mov rbp,rsp',
      '0x1008     8  c3             ret',
      '',
      'Source positions:',
      ' pc offset  position',
      `        0        ${functionStart + bodyStart}`,
      `        4        ${functionStart + bodyStart}`,
      `        8        ${functionStart + bodyStart}`,
      '',
      'Inlined functions (count = 0)',
    ].join('\n')

    const [block] = parseOptimizedBlocks(output)

    expect(block.sourcePositions).toHaveLength(3)
    expect(block.mappedRanges).toHaveLength(1)
    expect(block.mappedRanges[0]).toMatchObject({
      pcOffset: 0,
      pcOffsetHex: '0',
      instructionCount: 3,
    })
    expect(block.mappedRanges[0].pcRanges).toHaveLength(3)
    expect(block.mappedRanges[0].instructions).toContain('push rbp')
    expect(block.mappedRanges[0].instructions).toContain('ret')
  })

  it('groups repeated source positions by source extent instead of token offsets', () => {
    const rawSource = '(a){ const total = a + 1; return total }'
    const functionStart = 10
    const declarationStart = rawSource.indexOf('const total')
    const expressionStart = rawSource.indexOf('a + 1')
    const returnStart = rawSource.indexOf('return')
    const output = [
      `--- FUNCTION SOURCE ([eval]:jsperfUserBenchmark) id{4,-1} start{${functionStart}} ---`,
      rawSource,
      '--- END ---',
      '--- Raw source ---',
      rawSource,
      '',
      '--- Optimized code ---',
      'name = jsperfUserBenchmark',
      'Instructions (size = 32)',
      '0x1000     0  55             push rbp',
      '0x1004     4  4889e5         mov rbp,rsp',
      '0x1008     8  c3             ret',
      '0x100c     c  90             nop',
      '',
      'Source positions:',
      ' pc offset  position',
      `        0        ${functionStart + declarationStart}`,
      `        4        ${functionStart + expressionStart}`,
      `        8        ${functionStart + returnStart}`,
      `        c        ${functionStart + declarationStart}`,
      '',
      'Inlined functions (count = 0)',
    ].join('\n')

    const [block] = parseOptimizedBlocks(output)

    expect(block.mappedRanges).toHaveLength(2)
    expect(block.mappedRanges[0]).toMatchObject({
      sourceSnippet: 'const total = a + 1;',
      instructionCount: 3,
    })
    expect(block.mappedRanges[0].pcRanges).toHaveLength(3)
    expect(block.mappedRanges[0].instructions).toContain('push rbp')
    expect(block.mappedRanges[0].instructions).toContain('nop')
    expect(block.mappedRanges[0].instructions).not.toContain('ret')
    expect(block.mappedRanges[1]).toMatchObject({
      sourceSnippet: 'return total',
      instructionCount: 1,
    })
  })

  it('keeps nested block source instead of trimming at the first closing brace line', () => {
    const rawSource = [
      '(col) {',
      'const fn = (col) => {',
      '  let rr = [];',
      '  for (let i = 0; i < a.length; i++) {',
      '    if (i % 3 === col - 1) {',
      '      rr.push(a[i]);',
      '    }',
      '  }',
      '  return rr;',
      '}',
      '})',
    ].join('\n')
    const output = [
      '--- Raw source ---',
      rawSource,
      '',
      '--- Optimized code ---',
      'name = jsperfUserBenchmark',
      'Instructions (size = 64)',
      '0x1  0  55  push rbp',
    ].join('\n')

    const [block] = parseOptimizedBlocks(output)

    expect(block.source).toContain('rr.push(a[i]);')
    expect(block.source).toContain('return rr;')
    expect(block.source.trim().endsWith('}')).toBe(true)
  })
})
