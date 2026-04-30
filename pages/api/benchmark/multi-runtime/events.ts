/**
 * SSE proxy for long-running multi-runtime worker jobs.
 *
 * The browser opens one EventSource instead of polling one URL per job.
 * This route performs lightweight worker status checks, emits per-test
 * updates, and closes when every job reaches a terminal state or the worker
 * deadline expires.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { getShapedMultiRuntimeJob, type ShapedJobResult } from '../../../../lib/multiRuntimeJobResult'

const DEFAULT_DEADLINE_MS = 60_000
const POLL_INTERVAL_MS = 1500
const HEARTBEAT_INTERVAL_MS = 15_000
const MAX_STREAM_MS = 300_000

export const config = {
  maxDuration: 300,
}

type WorkerJobRef = {
  testIndex: number
  jobId: string
}

type SseResponse = NextApiResponse & {
  flushHeaders?: () => void
}

export default async function handler(req: NextApiRequest, res: SseResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const jobs = parseJobs(req.query.jobs)
  if (jobs.length === 0) {
    return res.status(400).json({ error: 'jobs query is required' })
  }

  const cacheKey = typeof req.query.codeHash === 'string' ? req.query.codeHash : null
  const deadlineAt = normalizeDeadlineAt(req.query.deadlineAt, req.query.deadlineMs)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write(`retry: ${POLL_INTERVAL_MS}\n\n`)

  let closed = false
  req.on?.('close', () => { closed = true })

  const remaining = new Map(jobs.map(job => [job.testIndex, job]))
  const streamStartedAt = Date.now()
  let lastHeartbeatAt = 0

  sendEvent(res, 'ready', {
    jobs,
    deadlineAt,
  })

  while (!closed && remaining.size > 0 && Date.now() < deadlineAt && Date.now() - streamStartedAt < MAX_STREAM_MS) {
    const updates = await Promise.all(
      Array.from(remaining.values()).map(async (job) => {
        try {
          const result = await getShapedMultiRuntimeJob(job.jobId, {
            cacheKey,
            testIndex: job.testIndex,
          })
          return { job, result }
        } catch (err) {
          return {
            job,
            result: {
              payload: {
                state: 'errored',
                error: `Worker error: ${err.message || String(err)}`,
              },
            } satisfies ShapedJobResult,
          }
        }
      })
    )

    for (const { job, result } of updates) {
      const payload: { testIndex: number, jobId: string, state?: string, error?: string } & Record<string, unknown> = {
        testIndex: job.testIndex,
        jobId: job.jobId,
        ...(result.payload || {}),
      }
      sendEvent(res, 'multi-runtime', payload)

      if (payload.state === 'done' || payload.state === 'errored' || result.status === 404 || result.status === 503) {
        remaining.delete(job.testIndex)
      }
    }

    if (remaining.size === 0) break

    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatAt = Date.now()
      sendEvent(res, 'heartbeat', { remaining: remaining.size })
    }

    await sleep(POLL_INTERVAL_MS)
  }

  if (!closed && remaining.size > 0) {
    for (const job of remaining.values()) {
      sendEvent(res, 'multi-runtime', {
        testIndex: job.testIndex,
        jobId: job.jobId,
        state: 'errored',
        error: 'Multi-runtime comparison is still running on the worker. Please try again in a moment.',
      })
    }
  }

  if (!closed) sendEvent(res, 'done', { ok: true })
  res.end()
}

function sendEvent(res: NextApiResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function parseJobs(value: string | string[] | undefined): WorkerJobRef[] {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (typeof raw !== 'string') return []

  return raw
    .split(',')
    .map(item => {
      const [testIndexRaw, jobIdRaw] = item.split(':')
      const testIndex = Number.parseInt(testIndexRaw, 10)
      const jobId = decodeURIComponent(jobIdRaw || '').trim()
      return Number.isFinite(testIndex) && jobId ? { testIndex, jobId } : null
    })
    .filter(Boolean)
    .slice(0, 20)
}

function normalizeDeadlineAt(deadlineAtInput: string | string[] | undefined, deadlineMsInput: string | string[] | undefined) {
  const deadlineAt = Number(Array.isArray(deadlineAtInput) ? deadlineAtInput[0] : deadlineAtInput)
  if (Number.isFinite(deadlineAt) && deadlineAt > Date.now()) {
    return Math.min(deadlineAt + 30_000, Date.now() + MAX_STREAM_MS)
  }

  const deadlineMs = Number(Array.isArray(deadlineMsInput) ? deadlineMsInput[0] : deadlineMsInput)
  const baseMs = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : DEFAULT_DEADLINE_MS
  return Math.min(Date.now() + baseMs + 30_000, Date.now() + MAX_STREAM_MS)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
