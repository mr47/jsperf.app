import type { NextApiRequest, NextApiResponse } from 'next'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../../../lib/rateLimit'
import {
  RATE_LIMIT,
  buildPipeline,
  createAnalysisSession,
  handleApiError,
  prepareDeepAnalysisRequest,
  readCachedAnalysis,
  saveAnalysisSession,
} from '../../../../lib/benchmark/deepAnalysis'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  let tier = 'free'
  try {
    const rl = await applyTieredRateLimit(req, 'analyze', RATE_LIMIT)
    tier = rl.tier || 'free'
    setRateLimitHeaders(res, rl)
    if (!rl.success) {
      const cap = rl.tier === 'donor' ? RATE_LIMIT.donor : RATE_LIMIT.free
      return res.status(429).json({
        error: `Too many requests. Deep analysis is limited to ${cap} every 5 minutes${rl.tier === 'donor' ? ' for donors' : ''}.`,
        tier: rl.tier,
      })
    }

    const prepared = prepareDeepAnalysisRequest(req.body)
    if (prepared.error) {
      return res.status(prepared.error.status).json(prepared.error.body)
    }

    const session = createAnalysisSession({ ...prepared, tier })
    await saveAnalysisSession(session)

    const cached = await readCachedAnalysis(session)
    res.setHeader('X-Analysis-Cache', cached ? 'HIT' : 'MISS')
    return res.status(200).json({
      sessionId: session.id,
      deadlineAt: session.deadlineAt,
      pipeline: buildPipeline(),
      codeHash: session.codeHash,
      multiRuntimeCacheKey: session.multiRuntimeCacheKey,
      cached: Boolean(cached),
      analysis: cached
        ? { ...cached, codeHash: session.codeHash, multiRuntimeCacheKey: session.multiRuntimeCacheKey }
        : null,
    })
  } catch (error) {
    return handleApiError(error, res, tier)
  }
}
