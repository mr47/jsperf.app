import type { NextApiRequest, NextApiResponse } from 'next'
import { buildAnalysisFromProfiles } from '../../../../lib/engines/runner'
import {
  assertSessionActive,
  attachAnalysisMeta,
  handleApiError,
  loadAnalysisSession,
  mergeMultiRuntimeMeta,
  persistAnalysis,
} from '../../../../lib/benchmark/deepAnalysis'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  let session
  try {
    session = await loadAnalysisSession(req.body?.sessionId)
    assertSessionActive(session)

    const quickjsProfiles = req.body?.quickjsProfiles
    const v8Profiles = req.body?.v8Profiles
    if (!Array.isArray(quickjsProfiles) || !Array.isArray(v8Profiles)) {
      return res.status(400).json({ error: 'quickjsProfiles and v8Profiles are required' })
    }

    const analysis = buildAnalysisFromProfiles(session.prepared.runtime.tests, {
      quickjsProfiles,
      v8Profiles,
      complexities: Array.isArray(req.body?.complexities) ? req.body.complexities : undefined,
    })
    const analysisWithMeta = attachAnalysisMeta(analysis, session)
    await persistAnalysis(session, analysisWithMeta)

    const final = {
      ...mergeMultiRuntimeMeta(analysisWithMeta, req.body?.multiRuntime || null),
      codeHash: session.codeHash,
      multiRuntimeCacheKey: session.multiRuntimeCacheKey,
    }
    return res.status(200).json(final)
  } catch (error) {
    return handleApiError(error, res, session?.tier)
  }
}
