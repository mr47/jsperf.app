import type { NextApiRequest, NextApiResponse } from 'next'
import { buildAnalysisFromProfiles } from '../../../../lib/engines/runner'
import {
  assertSessionActive,
  attachAnalysisMeta,
  handleApiError,
  loadAnalysisSession,
  loadEngineProfilesForFinalize,
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

    // Profiles come from the server-side session store written by the
    // /quickjs, /v8 and /worker routes — never from the request body.
    // The finalized analysis is cached per code hash for all users, so
    // client-supplied numbers would let one user poison it for everyone.
    const { quickjsProfiles, v8Profiles, complexities, multiRuntime } = await loadEngineProfilesForFinalize(session)

    const analysis = buildAnalysisFromProfiles(session.prepared.runtime.tests, {
      quickjsProfiles,
      v8Profiles,
      complexities,
    })
    const analysisWithMeta = attachAnalysisMeta(analysis, session)
    await persistAnalysis(session, analysisWithMeta)

    const final = {
      ...mergeMultiRuntimeMeta(analysisWithMeta, multiRuntime),
      codeHash: session.codeHash,
      multiRuntimeCacheKey: session.multiRuntimeCacheKey,
    }
    return res.status(200).json(final)
  } catch (error) {
    return handleApiError(error, res, session?.tier)
  }
}
