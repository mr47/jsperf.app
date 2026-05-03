import { describe, expect, it } from 'vitest'

import { groupJitArtifactEntries } from '../../utils/jitArtifactGroups'

describe('groupJitArtifactEntries', () => {
  it('groups JIT artifacts by benchmark test', () => {
    const groups = groupJitArtifactEntries([
      {
        testIndex: 0,
        title: 'Spread',
        runtime: 'node@24',
        runtimeLabel: 'Node.js 24',
        ref: { id: 'node-24', lineCount: 807, sizeBytes: 36_000 },
        error: null,
      },
      {
        testIndex: 0,
        title: 'Spread',
        runtime: 'deno@2',
        runtimeLabel: 'Deno 2',
        ref: { id: 'deno-2', lineCount: 22, sizeBytes: 2_600 },
        error: null,
      },
      {
        testIndex: 1,
        title: 'Concat',
        runtime: 'node@24',
        runtimeLabel: 'Node.js 24',
        ref: { id: 'concat-node', lineCount: 10, sizeBytes: 1_300 },
        error: null,
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      title: 'Spread',
      totalLineCount: 829,
      totalSizeBytes: 38_600,
      maxSizeBytes: 36_000,
    })
    expect(groups[0].artifacts.map(entry => entry.runtimeLabel)).toEqual(['Node.js 24', 'Deno 2'])
    expect(groups[1]).toMatchObject({
      title: 'Concat',
      totalLineCount: 10,
      maxSizeBytes: 1_300,
    })
  })

  it('keeps capture errors with their benchmark group', () => {
    const [group] = groupJitArtifactEntries([
      {
        testIndex: 2,
        title: 'Splice',
        runtime: 'node@26',
        runtimeLabel: 'Node.js 26',
        ref: null,
        error: 'No V8 JIT output was captured for this run',
      },
    ])

    expect(group.artifacts).toHaveLength(0)
    expect(group.errors).toHaveLength(1)
    expect(group.errors[0].runtimeLabel).toBe('Node.js 26')
  })
})
