import type { NextApiRequest, NextApiResponse } from 'next'
import { readFile } from 'fs/promises'
import path from 'path'
import { deflateRawSync } from 'zlib'
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

  const html = await renderCpuProReport(doc.cpuProfile, cpuProfileDownloadName(doc))

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(html)
}

async function renderCpuProReport(cpuProfile: unknown, filename: string) {
  const templateFile = path.join(process.cwd(), 'node_modules', 'cpupro', 'build', 'report.html')
  const template = await readFile(templateFile, 'utf8')
  const data = Buffer.from(JSON.stringify(cpuProfile), 'utf8')
  const chunks = printCompressedDiscoveryData(data)
  return `${template}
<script>discoveryLoader.start(${JSON.stringify({
    type: 'file',
    name: filename,
    size: data.byteLength,
    createdAt: Date.now(),
  })})</script>${chunks}
<script>discoveryLoader.finish(${chunks.length})</script>`
}

function printCompressedDiscoveryData(data: Buffer) {
  const maxChunkSize = 1024 * 1024
  const out: string[] = []
  for (let i = 0; i < data.byteLength; i += maxChunkSize) {
    const chunk = data.subarray(i, i + maxChunkSize)
    const encoded = deflateRawSync(chunk).toString('base64')
    out.push(
      `\n<script type="discovery/binary-compressed-data-chunk">${encoded}</script>` +
      `<script>(chunk=>{discoveryLoader.push(chunk, true, true)})(document.currentScript.previousSibling.text)</script>`,
    )
  }
  return out.join('')
}
