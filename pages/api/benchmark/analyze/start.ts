import type { NextApiRequest, NextApiResponse } from 'next'
import { applyTieredRateLimit, setRateLimitHeaders } from '../../../../lib/rateLimit'
import {
  RATE_LIMIT,
  WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
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

    const requestBody = applyDonorProfilingDefault(req.body, tier)
    const prepared = prepareDeepAnalysisRequest(requestBody)
    if (prepared.error) {
      return res.status(prepared.error.status).json(prepared.error.body)
    }

    if (prepared.workerExecutionMode === WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE) {
      if (tier !== 'donor') {
        return res.status(403).json({ error: 'Worker-side QuickJS analysis requires an active donor session' })
      }
      if (!process.env.BENCHMARK_WORKER_URL) {
        return res.status(503).json({ error: 'Worker-side analysis is not configured' })
      }
    }

    const workerExecutionMode = tier === 'donor' ? prepared.workerExecutionMode : null
    const session = createAnalysisSession({ ...prepared, tier, workerExecutionMode })
    await saveAnalysisSession(session)

    const cached = await readCachedAnalysis(session)
    console.info('[analysis] start session', {
      sessionId: session.id,
      tier,
      workerExecutionMode: session.workerExecutionMode || null,
      cached: Boolean(cached),
      codeHash: session.codeHash,
      multiRuntimeCacheKey: session.multiRuntimeCacheKey,
      profiling: session.multiRuntimeOptions?.profiling || null,
      runtimes: session.multiRuntimeOptions?.runtimes || null,
    })
    res.setHeader('X-Analysis-Cache', cached ? 'HIT' : 'MISS')
    return res.status(200).json({
      sessionId: session.id,
      tier,
      workerExecutionMode: session.workerExecutionMode || null,
      deadlineAt: session.deadlineAt,
      pipeline: buildPipeline({
        workerExecutionMode: session.workerExecutionMode,
        profiling: session.multiRuntimeOptions?.profiling || null,
      }),
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

function applyDonorProfilingDefault(body: any, tier: string) {
  if (tier !== 'donor' || body?.profiling != null) return body
  return {
    ...(body || {}),
    profiling: { nodeCpu: true },
  }
}
