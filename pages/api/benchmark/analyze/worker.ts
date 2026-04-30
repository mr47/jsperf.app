import type { NextApiRequest, NextApiResponse } from 'next'
import {
  assertSessionActive,
  estimateComplexitiesForSession,
  handleApiError,
  loadAnalysisSession,
  maybeEnqueueMultiRuntime,
  sessionAbortSignal,
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

    const signal = sessionAbortSignal(session)
    const [multiRuntime, complexities] = await Promise.all([
      maybeEnqueueMultiRuntime(session, { signal }),
      estimateComplexitiesForSession(session, signal),
    ])

    return res.status(200).json({ multiRuntime, complexities })
  } catch (error) {
    return handleApiError(error, res, session?.tier)
  }
}
