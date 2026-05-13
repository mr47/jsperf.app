import type { NextApiRequest, NextApiResponse } from 'next'
import { mkdtemp, readFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { cpuProfileDownloadName, loadCpuProfile } from '../../../../../lib/cpuProfiles'

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

  const filename = cpuProfileDownloadName(doc)
  const html = await renderCpuProReport(doc.cpuProfile, filename)

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/\.cpuprofile$/i, '.html')}"`)
  return res.status(200).send(html)
}

async function renderCpuProReport(cpuProfile: unknown, filename: string) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jsperf-cpupro-'))
  const reportFile = path.join(tmpDir, 'report.html')

  try {
    loadCpuProReportFactory()(cpuProfile, filename).writeToFile(reportFile)
    return await readFile(reportFile, 'utf8')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

function loadCpuProReportFactory(): (data: unknown, filename?: string) => { writeToFile(filepath: string): string } {
  const reportModulePath = path.join(process.cwd(), 'node_modules', 'cpupro', 'lib', 'report.js')
  const runtimeRequire = eval('require') as NodeRequire
  return runtimeRequire(reportModulePath)
}
