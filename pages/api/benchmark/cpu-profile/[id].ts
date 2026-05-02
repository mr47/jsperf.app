import type { NextApiRequest, NextApiResponse } from 'next'
import { cpuProfileDownloadName, getFocusedCpuProfile, loadCpuProfile } from '../../../../lib/cpuProfiles'

export const config = {
  maxDuration: 30,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!id) return res.status(400).json({ error: 'id is required' })

  const doc = await loadCpuProfile(id)
  if (!doc?.cpuProfile) return res.status(404).json({ error: 'CPU profile not found' })

  res.setHeader('Cache-Control', 'no-store')

  if (req.query.download === '1') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${cpuProfileDownloadName(doc)}"`)
    return res.status(200).send(JSON.stringify(doc.cpuProfile))
  }

  const focusedCpuProfile = getFocusedCpuProfile(doc)

  return res.status(200).json({
    id: doc.id,
    runtime: doc.runtime,
    runtimeName: doc.runtimeName,
    version: doc.version,
    label: doc.label,
    testIndex: doc.testIndex,
    profileLabel: doc.profileLabel,
    meta: doc.meta,
    cpuProfile: focusedCpuProfile,
  })
}
