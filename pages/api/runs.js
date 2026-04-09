import { runsCollection } from '../../lib/mongodb'
import { redis } from '../../lib/redis'
import { Ratelimit } from '@upstash/ratelimit'

// Create a new ratelimiter, that allows 5 requests per 1 minute
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  analytics: true,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    // Use a default IP or get it from headers
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1'
    const { success } = await ratelimit.limit(ip)

    if (!success) {
      return res.status(429).json({ error: 'Too many requests' })
    }

    const runs = await runsCollection()
    const payload = req.body

    // Validate payload roughly
    if (!payload.slug || !payload.revision || !payload.results || !Array.isArray(payload.results)) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    const doc = {
      slug: payload.slug,
      revision: payload.revision,
      browserName: payload.browserName,
      browserVersion: payload.browserVersion,
      osName: payload.osName,
      deviceType: payload.deviceType,
      cpuArch: payload.cpuArch,
      renderer: payload.renderer,
      cpuCores: payload.cpuCores,
      ramGB: payload.ramGB,
      createdAt: new Date(),
      results: payload.results.map(r => ({
        testIndex: r.testIndex,
        opsPerSec: r.opsPerSec
      }))
    }

    await runs.insertOne(doc)

    // Invalidate the cache for this slug and revision
    await redis.del(`stats_v3:${payload.slug}:${payload.revision}`)

    res.status(200).json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
