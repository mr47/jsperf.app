import type { NextApiRequest, NextApiResponse } from 'next'
import { runV8Analysis } from '../../../../lib/engines/runner'
import {
  assertSessionActive,
  handleApiError,
  loadAnalysisSession,
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

    const profiles = await runV8Analysis(session.prepared.runtime.tests, {
      setup: session.prepared.runtime.setup || undefined,
      teardown: session.prepared.runtime.teardown || undefined,
      timeMs: 2000,
      snapshotId: undefined,
      signal: sessionAbortSignal(session),
      onProgress: undefined,
    })

    return res.status(200).json({ profiles })
  } catch (error) {
    return handleApiError(error, res, session?.tier)
  }
}
