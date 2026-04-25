// @ts-nocheck
import { redis } from '../../../lib/redis'
import { fetchRuntimeTagSummary } from '../../../lib/engines/runtime-tags'

const CACHE_KEY = 'runtime_tags_v1'
const CACHE_TTL_SECONDS = 60 * 60

export const config = {
  maxDuration: 15,
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null)
    if (cached) {
      const payload = typeof cached === 'string' ? JSON.parse(cached) : cached
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
      res.setHeader('X-Runtime-Tags-Cache', 'HIT')
      return res.status(200).json(payload)
    }

    const payload = await fetchRuntimeTagSummary()
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(payload)).catch(() => {})

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
    res.setHeader('X-Runtime-Tags-Cache', 'MISS')
    return res.status(200).json(payload)
  } catch (error) {
    return res.status(502).json({
      error: `Unable to load runtime tags: ${error.message || String(error)}`,
    })
  }
}
