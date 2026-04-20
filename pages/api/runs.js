import { runsCollection } from '../../lib/mongodb'
import { redis } from '../../lib/redis'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../lib/rateLimit'

// Free: 30/min by IP. Donor: 120/min by donor identity.
const RATE_LIMIT = { free: 30, donor: 120, window: '1 m' }

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

    const runs = await runsCollection()
    const payload = req.body

    // Validate payload roughly
    if (!payload.slug || !payload.revision || !payload.results || !Array.isArray(payload.results)) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    const doc = {
      slug: String(payload.slug),
      revision: parseInt(payload.revision, 10),
      browserName: payload.browserName ? String(payload.browserName) : null,
      browserVersion: payload.browserVersion ? String(payload.browserVersion) : null,
      osName: payload.osName ? String(payload.osName) : null,
      deviceType: payload.deviceType ? String(payload.deviceType) : null,
      cpuArch: payload.cpuArch ? String(payload.cpuArch) : null,
      renderer: payload.renderer ? String(payload.renderer) : null,
      cpuCores: payload.cpuCores ? parseInt(payload.cpuCores, 10) : null,
      ramGB: payload.ramGB ? parseInt(payload.ramGB, 10) : null,
      createdAt: new Date(),
      results: payload.results.map(r => ({
        testIndex: parseInt(r.testIndex, 10),
        opsPerSec: parseFloat(r.opsPerSec)
      }))
    }

    await runs.insertOne(doc)

    // Invalidate the cache for this slug and revision
    await redis.del(`stats_v3:${doc.slug}:${doc.revision}`)

    res.status(200).json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
