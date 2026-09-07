// @ts-nocheck
import { pagesCollection, runsCollection } from '../../lib/mongodb'
import { redis } from '../../lib/redis'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../lib/rateLimit'
import { rejectIfBanned } from '../../lib/bans'
import { logServerError } from '../../lib/errorLog'

// One POST per completed benchmark run (all test results in a single payload),
// so this doesn't need to be high. Free: 10/min by IP, donor: 60/min by identity.
const RATE_LIMIT = { free: 10, donor: 60, window: '1 m' }

// Generated slugs are lowercase letters; imported jsperf.com slugs may also
// contain digits, dots, underscores and hyphens.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i
// An empty loop tops out around 1e9 ops/s on fast hardware; anything far
// beyond that is not a real measurement.
const MAX_OPS_PER_SEC = 1e12

const shortString = (value, max = 80) => {
  if (value == null) return null
  const str = String(value).trim()
  return str ? str.slice(0, max) : null
}

const boundedInt = (value, min, max) => {
  if (value == null || value === '') return null
  const n = parseInt(value, 10)
  if (!Number.isInteger(n)) return null
  return Math.min(max, Math.max(min, n))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const rl = await applyTieredRateLimit(req, 'runs', RATE_LIMIT)
    setRateLimitHeaders(res, rl)

    if (!rl.success) {
      return res.status(429).json({ error: 'Too many requests', tier: rl.tier })
    }

    if (await rejectIfBanned(req, res)) return

    const payload = req.body
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    const slug = typeof payload.slug === 'string' ? payload.slug.trim() : ''
    const revision = parseInt(payload.revision, 10)
    if (!SLUG_PATTERN.test(slug) || !Number.isInteger(revision) || revision < 1) {
      return res.status(400).json({ error: 'Invalid payload' })
    }
    if (!Array.isArray(payload.results) || payload.results.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    // Runs are only meaningful for a benchmark that exists; this also
    // bounds `results` to the benchmark's test count so junk cannot skew
    // the stats aggregation.
    const pages = await pagesCollection()
    const page = await pages.findOne({ slug, revision }, { projection: { _id: 1, tests: 1 } })
    if (!page) {
      return res.status(404).json({ error: 'Unknown benchmark' })
    }
    const testCount = Array.isArray(page.tests) ? page.tests.length : 0
    if (payload.results.length > Math.max(testCount, 1)) {
      return res.status(400).json({ error: 'Too many results for this benchmark' })
    }

    const seen = new Set()
    const results = []
    for (const r of payload.results) {
      const testIndex = parseInt(r?.testIndex, 10)
      const opsPerSec = Number(r?.opsPerSec)
      if (!Number.isInteger(testIndex) || testIndex < 0 || testIndex >= Math.max(testCount, 1) || seen.has(testIndex)) {
        return res.status(400).json({ error: 'Invalid test index' })
      }
      if (!Number.isFinite(opsPerSec) || opsPerSec < 0 || opsPerSec > MAX_OPS_PER_SEC) {
        return res.status(400).json({ error: 'Invalid opsPerSec' })
      }
      seen.add(testIndex)
      results.push({ testIndex, opsPerSec })
    }

    const runs = await runsCollection()
    const doc = {
      slug,
      revision,
      browserName: shortString(payload.browserName),
      browserVersion: shortString(payload.browserVersion),
      osName: shortString(payload.osName),
      deviceType: shortString(payload.deviceType),
      cpuArch: shortString(payload.cpuArch),
      renderer: shortString(payload.renderer, 200),
      cpuCores: boundedInt(payload.cpuCores, 1, 1024),
      ramGB: boundedInt(payload.ramGB, 0, 4096),
      createdAt: new Date(),
      results,
    }

    await runs.insertOne(doc)

    // Invalidate the cache for this slug and revision
    await redis.del(`stats_v3:${doc.slug}:${doc.revision}`)

    res.status(200).json({ success: true })
  } catch (error) {
    void logServerError('runs.create', error, { req })
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
