import { describe, expect, it } from 'vitest'
import { buildPrediction, compareTests, buildRuntimeComparison } from '../../lib/prediction/model'

describe('buildPrediction', () => {
  it('detects linear scaling (2x resources -> ~2x ops)', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 1000 },
        { label: '2x', resourceLevel: 2, opsPerSec: 1000 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 10000 },
        { label: '2x', resourceLevel: 2, opsPerSec: 20000 },
        { label: '4x', resourceLevel: 4, opsPerSec: 40000 },
      ],
    })

    expect(result.scalingType).toBe('linear')
    expect(result.scalingConfidence).toBeGreaterThan(0.9)
  })

  it('detects sublinear scaling', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 1000 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 10000 },
        { label: '2x', resourceLevel: 2, opsPerSec: 15000 },
        { label: '4x', resourceLevel: 4, opsPerSec: 18000 },
      ],
    })

    expect(['sublinear', 'plateau']).toContain(result.scalingType)
  })

  it('computes JIT benefit ratio (v8/quickjs)', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 100 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 5000 },
      ],
    })

    expect(result.jitBenefit).toBe(50)
  })

  it('classifies CPU-bound characteristics', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 100 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 1000 },
        { label: '2x', resourceLevel: 2, opsPerSec: 2000 },
        { label: '4x', resourceLevel: 4, opsPerSec: 4000 },
      ],
    })

    expect(result.characteristics.cpuBound).toBe(true)
    expect(result.characteristics.memoryBound).toBe(false)
  })

  it('classifies JIT-friendly code (high jitBenefit)', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 100 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 5000 },
      ],
    })

    expect(result.characteristics.jitFriendly).toBe(true)
  })

  it('classifies non-JIT-friendly code (low jitBenefit)', () => {
    const result = buildPrediction({
      quickjsProfiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 1000 },
      ],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 3000 },
      ],
    })

    expect(result.characteristics.jitFriendly).toBe(false)
  })

  it('returns predictedAt values', () => {
    const result = buildPrediction({
      quickjsProfiles: [],
      v8Profiles: [
        { label: '1x', resourceLevel: 1, opsPerSec: 1000 },
        { label: '2x', resourceLevel: 2, opsPerSec: 2000 },
        { label: '4x', resourceLevel: 4, opsPerSec: 4000 },
      ],
    })

    expect(result.predictedAt).toHaveProperty('1x')
    expect(result.predictedAt).toHaveProperty('2x')
    expect(result.predictedAt).toHaveProperty('4x')
    expect(result.predictedAt).toHaveProperty('8x')
    expect(result.predictedAt['8x']).toBeGreaterThan(result.predictedAt['4x'])
  })

  it('handles empty profiles gracefully', () => {
    const result = buildPrediction({
      quickjsProfiles: [],
      v8Profiles: [],
    })

    expect(result.jitBenefit).toBe(0)
    expect(result.scalingType).toBe('insufficient-data')
  })
})

describe('compareTests', () => {
  it('identifies fastest by algorithm vs fastest by runtime', () => {
    const result = compareTests([
      { quickjsOps: 200, v8Ops: 5000 },
      { quickjsOps: 300, v8Ops: 3000 },
    ])

    expect(result.fastestByAlgorithm).toBe(1)
    expect(result.fastestByRuntime).toBe(0)
    expect(result.divergence).toBe(true)
  })

  it('sets divergence=false when winners match', () => {
    const result = compareTests([
      { quickjsOps: 300, v8Ops: 5000 },
      { quickjsOps: 200, v8Ops: 3000 },
    ])

    expect(result.fastestByAlgorithm).toBe(0)
    expect(result.fastestByRuntime).toBe(0)
    expect(result.divergence).toBe(false)
  })

  it('handles empty tests', () => {
    const result = compareTests([])
    expect(result.fastestByAlgorithm).toBe(-1)
    expect(result.fastestByRuntime).toBe(-1)
    expect(result.divergence).toBe(false)
  })

  it('handles single test', () => {
    const result = compareTests([{ quickjsOps: 100, v8Ops: 500 }])
    expect(result.fastestByAlgorithm).toBe(0)
    expect(result.fastestByRuntime).toBe(0)
    expect(result.divergence).toBe(false)
  })
})

describe('buildRuntimeComparison', () => {
  const sampleProfile = (label, level, opsPerSec) => ({
    label,
    resourceLevel: level,
    cpus: level * 0.5,
    memMb: 256 * level,
    opsPerSec,
    state: opsPerSec > 0 ? 'completed' : 'errored',
    latency: opsPerSec > 0 ? { mean: 1000 / opsPerSec, p50: 1000 / opsPerSec, p99: 2000 / opsPerSec } : null,
    memory: opsPerSec > 0 ? { after: { rss: 50_000_000, heapUsed: 20_000_000 } } : null,
    perfCounters: null,
  })

  it('returns null for missing input', () => {
    expect(buildRuntimeComparison(null)).toBeNull()
    expect(buildRuntimeComparison(undefined)).toBeNull()
  })

  it('ranks runtimes by average ops/sec and exposes spread', () => {
    const cmp = buildRuntimeComparison({
      node: { profiles: [sampleProfile('1x', 1, 10000), sampleProfile('2x', 2, 20000)] },
      deno: { profiles: [sampleProfile('1x', 1, 9000), sampleProfile('2x', 2, 18000)] },
      bun: { profiles: [sampleProfile('1x', 1, 30000), sampleProfile('2x', 2, 60000)] },
    })

    expect(cmp.available).toBe(true)
    expect(cmp.fastestRuntime).toBe('bun')
    expect(cmp.slowestRuntime).toBe('deno')
    expect(cmp.spread).toBeGreaterThan(1)
    expect(cmp.ranking[0].runtime).toBe('bun')
  })

  it('classifies linear scaling per runtime', () => {
    const cmp = buildRuntimeComparison({
      node: {
        profiles: [
          sampleProfile('1x', 1, 1000),
          sampleProfile('2x', 2, 2000),
          sampleProfile('4x', 4, 4000),
          sampleProfile('8x', 8, 8000),
        ],
      },
    })
    const node = cmp.runtimes.find(r => r.runtime === 'node')
    expect(node.scalingType).toBe('linear')
    expect(node.scalingConfidence).toBeGreaterThan(0.9)
  })

  it('flags errored runtimes without breaking ranking', () => {
    const cmp = buildRuntimeComparison({
      node: { profiles: [sampleProfile('1x', 1, 1000)] },
      deno: { error: 'crashed', profiles: [sampleProfile('1x', 1, 0)] },
    })

    const deno = cmp.runtimes.find(r => r.runtime === 'deno')
    expect(deno.hasError).toBe(true)
    expect(cmp.fastestRuntime).toBe('node')
    expect(cmp.ranking).toHaveLength(1)
  })

  it('keeps version metadata for versioned runtime keys', () => {
    const cmp = buildRuntimeComparison({
      'node@22': { runtime: 'node', version: '22', label: 'Node.js 22', profiles: [sampleProfile('1x', 1, 1000)] },
      'node@24': { runtime: 'node', version: '24', label: 'Node.js 24', profiles: [sampleProfile('1x', 1, 1200)] },
    })

    const node22 = cmp.runtimes.find(r => r.runtime === 'node@22')
    expect(node22.runtimeName).toBe('node')
    expect(node22.version).toBe('22')
    expect(node22.label).toBe('Node.js 22')
    expect(cmp.fastestRuntime).toBe('node@24')
  })

  it('reports no available data when all runtimes errored', () => {
    const cmp = buildRuntimeComparison({
      node: { profiles: [sampleProfile('1x', 1, 0)] },
      bun: { error: 'oom', profiles: [] },
    })
    expect(cmp.available).toBe(false)
    expect(cmp.fastestRuntime).toBeNull()
  })
})
