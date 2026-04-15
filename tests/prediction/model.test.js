import { describe, expect, it } from 'vitest'
import { buildPrediction, compareTests } from '../../lib/prediction/model'

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
