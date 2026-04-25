// @ts-nocheck
import { describe, expect, it } from 'vitest'
import {
  linearRegression,
  logarithmicRegression,
  powerRegression,
  bestFit,
} from '../../lib/prediction/regression'

describe('linearRegression', () => {
  it('fits y = 2x + 1 exactly', () => {
    const points = [[1, 3], [2, 5], [3, 7], [4, 9]]
    const result = linearRegression(points)

    expect(result.slope).toBeCloseTo(2, 5)
    expect(result.intercept).toBeCloseTo(1, 5)
    expect(result.rSquared).toBeCloseTo(1, 5)
  })

  it('returns slope, intercept, rSquared', () => {
    const points = [[1, 2], [2, 4], [3, 5]]
    const result = linearRegression(points)

    expect(result).toHaveProperty('slope')
    expect(result).toHaveProperty('intercept')
    expect(result).toHaveProperty('rSquared')
    expect(result.slope).toBeGreaterThan(0)
    expect(result.rSquared).toBeGreaterThan(0.5)
  })

  it('handles single data point', () => {
    const result = linearRegression([[5, 10]])
    expect(result.intercept).toBe(10)
    expect(result.slope).toBe(0)
    expect(result.rSquared).toBe(1)
  })

  it('handles empty array', () => {
    const result = linearRegression([])
    expect(result.slope).toBe(0)
    expect(result.intercept).toBe(0)
    expect(result.rSquared).toBe(0)
  })

  it('handles constant y values', () => {
    const points = [[1, 5], [2, 5], [3, 5]]
    const result = linearRegression(points)
    expect(result.slope).toBeCloseTo(0)
    expect(result.intercept).toBeCloseTo(5)
    expect(result.rSquared).toBe(1)
  })

  it('computes R-squared for imperfect fit', () => {
    const points = [[1, 2], [2, 5], [3, 4], [4, 8]]
    const result = linearRegression(points)
    expect(result.rSquared).toBeGreaterThan(0.5)
    expect(result.rSquared).toBeLessThan(1)
  })
})

describe('logarithmicRegression', () => {
  it('fits y = a * ln(x) + b', () => {
    const a = 3, b = 2
    const points = [1, 2, 3, 5, 10].map(x => [x, a * Math.log(x) + b])
    const result = logarithmicRegression(points)

    expect(result.a).toBeCloseTo(a, 3)
    expect(result.b).toBeCloseTo(b, 3)
    expect(result.rSquared).toBeCloseTo(1, 3)
  })

  it('handles single point', () => {
    const result = logarithmicRegression([[5, 10]])
    expect(result.b).toBe(10)
    expect(result.rSquared).toBe(1)
  })

  it('filters out x <= 0', () => {
    const points = [[-1, 5], [0, 3], [1, 2], [2, 4]]
    const result = logarithmicRegression(points)
    expect(result).toHaveProperty('a')
    expect(result).toHaveProperty('b')
  })
})

describe('powerRegression', () => {
  it('fits y = a * x^b for quadratic', () => {
    const points = [[1, 1], [2, 4], [3, 9], [4, 16]]
    const result = powerRegression(points)

    expect(result.b).toBeCloseTo(2, 1)
    expect(result.a).toBeCloseTo(1, 1)
    expect(result.rSquared).toBeGreaterThan(0.99)
  })

  it('filters out non-positive values', () => {
    const points = [[-1, 5], [0, 0], [1, 2], [2, 8]]
    const result = powerRegression(points)
    expect(result).toHaveProperty('a')
    expect(result).toHaveProperty('b')
  })
})

describe('bestFit', () => {
  it('selects linear for linear data', () => {
    const points = [[1, 2], [2, 4], [3, 6], [4, 8]]
    const result = bestFit(points)
    expect(result.type).toBe('linear')
    expect(result.rSquared).toBeGreaterThan(0.99)
    expect(result.predict(5)).toBeCloseTo(10, 0)
  })

  it('returns constant for single point', () => {
    const result = bestFit([[3, 7]])
    expect(result.type).toBe('constant')
    expect(result.predict(999)).toBe(7)
  })

  it('returns the model with highest R-squared', () => {
    const points = [[1, 1], [2, 4], [3, 9], [4, 16], [5, 25]]
    const result = bestFit(points)
    expect(result.rSquared).toBeGreaterThan(0.95)
    expect(typeof result.predict).toBe('function')
  })

  it('has a working predict function', () => {
    const points = [[1, 10], [2, 20], [3, 30]]
    const result = bestFit(points)
    const predicted = result.predict(4)
    expect(predicted).toBeGreaterThan(35)
    expect(predicted).toBeLessThan(45)
  })
})
