import { runsCollection } from '../../lib/mongodb'
import { redis } from '../../lib/redis'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const { slug, revision } = req.query

    if (!slug || !revision) {
      return res.status(400).json({ error: 'Missing slug or revision' })
    }

    const rev = parseInt(revision, 10)

    const cacheKey = `stats_v3:${slug}:${rev}`
    const cachedStats = await redis.get(cacheKey)

    if (cachedStats) {
      // Add a header to indicate this was a cache hit
      res.setHeader('X-Cache', 'HIT')
      return res.status(200).json(cachedStats)
    }

    const runs = await runsCollection()

    // Aggregation pipeline to get stats per testIndex
    const pipeline = [
      { $match: { slug: String(slug), revision: rev } },
      { $unwind: '$results' },
      { 
        // Exclude runs that errored out or returned null ops
        $match: { 'results.opsPerSec': { $gt: 0 } }
      },
      {
        $group: {
          _id: {
            testIndex: '$results.testIndex',
            browserName: { $ifNull: ['$browserName', 'unknown'] },
            osName: { $ifNull: ['$osName', 'unknown'] },
            cpuArch: { $ifNull: ['$cpuArch', 'unknown'] }
          },
          avgOps: { $avg: '$results.opsPerSec' },
          count: { $sum: 1 }
        }
      },
      { $sort: { avgOps: -1 } },
      {
        $group: {
          _id: '$_id.testIndex',
          stats: {
            $push: {
              browserName: '$_id.browserName',
              osName: '$_id.osName',
              cpuArch: '$_id.cpuArch',
              avgOps: '$avgOps',
              count: '$count'
            }
          }
        }
      }
    ]

    const aggregationResults = await runs.aggregate(pipeline).toArray()
    
    // Transform into a mapping from testIndex -> array of stats
    const statsByTest = {}
    for (const res of aggregationResults) {
      statsByTest[res._id] = res.stats
    }

    // Cache the result for 5 minutes (300 seconds)
    await redis.setex(cacheKey, 300, JSON.stringify(statsByTest))

    res.setHeader('X-Cache', 'MISS')
    res.status(200).json(statsByTest)
  } catch (error) {
    console.error('Failed to get stats', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
