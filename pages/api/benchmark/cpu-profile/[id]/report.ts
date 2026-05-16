import type { NextApiRequest, NextApiResponse } from 'next'
import { readFile } from 'fs/promises'
import { cpuProfileDownloadName, loadCpuProfile } from '../../../../../lib/cpuProfiles'

const CPU_PRO_REPORT_TEMPLATE_PATH = require.resolve('cpupro/build/report.html')
const CPU_PRO_DATA_CHUNK_SIZE = 1024 * 1024
const SCRIPT_UNSAFE_CHARS = /[<\u2028\u2029]/g
const RAW_DATA_OPEN = '\n<script type="discovery/data-chunk">'
const RAW_DATA_CLOSE = '</script><script>\n(chunk=>{discoveryLoader.push(chunk, false, false)})(document.currentScript.previousSibling.text)</script>'

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
  const reportTemplate = await readFile(CPU_PRO_REPORT_TEMPLATE_PATH, 'utf8')
  const profileJson = JSON.stringify(cpuProfile)
  if (!profileJson) throw new Error('Unable to serialize CPU profile')

  return reportTemplate + renderCpuProDataScripts(profileJson, filename)
}

function renderCpuProDataScripts(data: string, filename: string) {
  const dataPrinter = createRawTextDataPrinter()
  const chunks = [
    `\n<script>discoveryLoader.start(${scriptJson({
      type: 'file',
      name: filename,
      size: data.length,
      createdAt: Date.now(),
    })})</script>`,
  ]
  let encodedSize = 0

  for (let offset = 0; offset < data.length; offset += CPU_PRO_DATA_CHUNK_SIZE) {
    for (const chunk of dataPrinter.push(data.slice(offset, offset + CPU_PRO_DATA_CHUNK_SIZE))) {
      encodedSize += chunk.length
      chunks.push(chunk)
    }
  }

  for (const chunk of dataPrinter.finish()) {
    encodedSize += chunk.length
    chunks.push(chunk)
  }

  chunks.push(`\n<script>discoveryLoader.finish(${encodedSize})</script>`)
  return chunks.join('')
}

function createRawTextDataPrinter() {
  let ensureOpen = RAW_DATA_OPEN
  let bufferSize = 0
  let tail: string | null = null

  return {
    *push(chunk: string): Generator<string> {
      let safePart: string

      if (tail === null && !chunk.includes('</')) {
        safePart = chunk
      } else {
        const safeParts = (tail !== null ? tail + chunk : chunk).split(/<\/(script)/i)

        for (let i = 0; i < safeParts.length - 1; i += 2) {
          yield `${ensureOpen}${safeParts[i]}</${RAW_DATA_CLOSE}${RAW_DATA_OPEN}${safeParts[i + 1]}`
          ensureOpen = ''
          bufferSize = 6
        }

        safePart = safeParts[safeParts.length - 1]
      }

      if (bufferSize + safePart.length >= CPU_PRO_DATA_CHUNK_SIZE) {
        yield ensureOpen + safePart + RAW_DATA_CLOSE
        ensureOpen = RAW_DATA_OPEN
        bufferSize = 0
        tail = null
      } else {
        const tailCandidate = safePart.slice(-7).match(/<(\/(s(c(r(ip?)?)?)?)?)?$/i)
        tail = tailCandidate !== null ? tailCandidate[0] : null

        if (tail !== null) {
          safePart = safePart.slice(0, -tail.length)
        }

        if (safePart.length > 0) {
          yield ensureOpen + safePart
          ensureOpen = ''
          bufferSize += safePart.length
        }
      }
    },
    *finish(): Generator<string> {
      if (tail !== null) {
        yield ensureOpen + tail + RAW_DATA_CLOSE
      } else if (bufferSize > 0) {
        yield RAW_DATA_CLOSE
      }
    },
  }
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE_CHARS, (char) => {
    switch (char) {
      case '<':
        return '\\u003c'
      case '\u2028':
        return '\\u2028'
      case '\u2029':
        return '\\u2029'
      default:
        return char
    }
  })
}
