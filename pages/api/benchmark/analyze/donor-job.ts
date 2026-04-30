import type { NextApiRequest, NextApiResponse } from 'next'
import {
  advanceDonorAnalysisJob,
  createDonorAnalysisJob,
  loadDonorAnalysisJob,
} from '../../../../lib/benchmark/donorAnalysisJob'
import {
  assertSessionActive,
  handleApiError,
  loadAnalysisSession,
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
    if (session?.tier !== 'donor') {
      return res.status(403).json({ error: 'Donor deep analysis jobs require an active donor session' })
    }

    let job = req.body?.jobId
      ? await loadDonorAnalysisJob(req.body.jobId)
      : null

    if (req.body?.jobId && !job) {
      return res.status(404).json({ error: 'Donor analysis job expired' })
    }

    if (!job) {
      job = await createDonorAnalysisJob(session)
    }

    const result = await advanceDonorAnalysisJob(session, job)
    return res.status(200).json(result)
  } catch (error) {
    return handleApiError(error, res, session?.tier)
  }
}
