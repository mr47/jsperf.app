/**
 * Lightweight regression helpers for performance prediction.
 * No external dependencies -- pure math.
 */

/**
 * Ordinary least-squares linear regression: y = slope * x + intercept
 *
 * @param {number[][]} points - Array of [x, y] pairs
 * @returns {{ slope: number, intercept: number, rSquared: number }}
 */
export function linearRegression(points) {
  const n = points.length
  if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 }
  if (n === 1) return { slope: 0, intercept: points[0][1], rSquared: 1 }

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (const [x, y] of points) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const rSquared = computeRSquared(points, (x) => slope * x + intercept)

  return { slope, intercept, rSquared }
}

/**
 * Logarithmic regression: y = a * ln(x) + b
 * Transforms x -> ln(x) and runs linear regression.
 *
 * @param {number[][]} points - Array of [x, y] pairs (x > 0)
 * @returns {{ a: number, b: number, rSquared: number }}
 */
export function logarithmicRegression(points) {
  const valid = points.filter(([x]) => x > 0)
  if (valid.length < 2) {
    const y = valid.length === 1 ? valid[0][1] : 0
    return { a: 0, b: y, rSquared: valid.length === 1 ? 1 : 0 }
  }

  const transformed = valid.map(([x, y]) => [Math.log(x), y])
  const { slope, intercept, rSquared } = linearRegression(transformed)

  return { a: slope, b: intercept, rSquared }
}

/**
 * Power-law regression: y = a * x^b
 * Transforms to ln(y) = b * ln(x) + ln(a) and runs linear regression.
 *
 * @param {number[][]} points - Array of [x, y] pairs (x > 0, y > 0)
 * @returns {{ a: number, b: number, rSquared: number }}
 */
export function powerRegression(points) {
  const valid = points.filter(([x, y]) => x > 0 && y > 0)
  if (valid.length < 2) {
    const y = valid.length === 1 ? valid[0][1] : 0
    return { a: y, b: 0, rSquared: valid.length === 1 ? 1 : 0 }
  }

  const transformed = valid.map(([x, y]) => [Math.log(x), Math.log(y)])
  const { slope, intercept, rSquared } = linearRegression(transformed)

  return { a: Math.exp(intercept), b: slope, rSquared }
}

/**
 * Compute R² (coefficient of determination) for a model.
 *
 * @param {number[][]} points - Array of [x, y] pairs
 * @param {(x: number) => number} predict - Prediction function
 * @returns {number} R² value (0 to 1, clamped)
 */
function computeRSquared(points, predict) {
  const n = points.length
  if (n < 2) return 1

  let sumY = 0
  for (const [, y] of points) sumY += y
  const meanY = sumY / n

  let ssTot = 0, ssRes = 0
  for (const [x, y] of points) {
    ssTot += (y - meanY) ** 2
    ssRes += (y - predict(x)) ** 2
  }

  if (ssTot === 0) return 1
  return Math.max(0, 1 - ssRes / ssTot)
}

/**
 * Find the best-fitting model among linear, logarithmic, and power-law.
 *
 * @param {number[][]} points - Array of [x, y] pairs
 * @returns {{ type: string, rSquared: number, predict: (x: number) => number, params: object }}
 */
export function bestFit(points) {
  if (points.length < 2) {
    const y = points.length === 1 ? points[0][1] : 0
    return { type: 'constant', rSquared: 1, predict: () => y, params: { value: y } }
  }

  const lin = linearRegression(points)
  const log = logarithmicRegression(points)
  const pow = powerRegression(points)

  const candidates = [
    {
      type: 'linear',
      rSquared: lin.rSquared,
      predict: (x) => lin.slope * x + lin.intercept,
      params: lin,
    },
    {
      type: 'logarithmic',
      rSquared: log.rSquared,
      predict: (x) => log.a * Math.log(Math.max(x, 1e-10)) + log.b,
      params: log,
    },
    {
      type: 'power',
      rSquared: pow.rSquared,
      predict: (x) => pow.a * Math.pow(Math.max(x, 1e-10), pow.b),
      params: pow,
    },
  ]

  candidates.sort((a, b) => b.rSquared - a.rSquared)
  return candidates[0]
}
