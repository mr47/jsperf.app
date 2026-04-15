import { analysesCollection } from '../../../lib/mongodb'
import { redis } from '../../../lib/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { runAnalysis } from '../../../lib/engines/runner'
import crypto from 'crypto'

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(2, '1 m'),
  analytics: true,
})

export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1'
    const { success } = await ratelimit.limit(`analyze:${ip}`)
    if (!success) {
      return res.status(429).json({ error: 'Too many requests. Deep analysis is limited to 2 per minute.' })
    }

    const { tests, setup, teardown, slug, revision } = req.body

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({ error: 'tests array is required and must not be empty' })
    }

    if (tests.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 tests per analysis' })
    }

    for (const test of tests) {
      if (!test.code || typeof test.code !== 'string') {
        return res.status(400).json({ error: 'Each test must have a non-empty code string' })
      }
    }

    // Check cache by content hash
    const codeHash = computeCodeHash(tests, setup, teardown)
    const cacheKey = `analysis_v2:${codeHash}`

    const cached = await redis.get(cacheKey)
    if (cached) {
      res.setHeader('X-Analysis-Cache', 'HIT')
      return res.status(200).json(typeof cached === 'string' ? JSON.parse(cached) : cached)
    }

    // Stream NDJSON progress + final result
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Analysis-Cache', 'MISS')
    res.status(200)

    const sendLine = (obj) => {
      res.write(JSON.stringify(obj) + '\n')
    }

    // Run the analysis with progress streaming
    const analysis = await runAnalysis(tests, {
      setup: setup || undefined,
      teardown: teardown || undefined,
      timeMs: 2000,
      onProgress: (step) => sendLine({ type: 'progress', ...step }),
    })

    // Persist to MongoDB
    const analyses = await analysesCollection()
    const doc = {
      codeHash,
      slug: slug ? String(slug) : null,
      revision: revision ? parseInt(revision, 10) : null,
      results: analysis.results,
      comparison: analysis.comparison,
      hasErrors: analysis.hasErrors || false,
      createdAt: new Date(),
    }
    await analyses.insertOne(doc)

    // Only cache successful (error-free) results
    if (!analysis.hasErrors) {
      await redis.setex(cacheKey, 3600, JSON.stringify(analysis))
    }

    sendLine({ type: 'result', data: analysis })
    return res.end()
  } catch (error) {
    console.error('Analysis error:', error)

    if (res.headersSent) {
      const errMsg = error.name === 'AbortError' ? 'Analysis timed out' : 'Internal Server Error'
      res.write(JSON.stringify({ type: 'error', error: errMsg }) + '\n')
      return res.end()
    }

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out' })
    }

    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

function computeCodeHash(tests, setup, teardown) {
  const content = JSON.stringify({
    tests: tests.map(t => ({ code: t.code.trim() })),
    setup: (setup || '').trim(),
    teardown: (teardown || '').trim(),
  })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}
