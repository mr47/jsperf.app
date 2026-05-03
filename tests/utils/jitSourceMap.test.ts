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
})
