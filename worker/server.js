/**
 * jsperf.app multi-runtime benchmark worker.
 *
 * Exposes a single POST endpoint at /api/run. Streams NDJSON results back to
 * the caller as each (runtime, profile) combination finishes, so the UI can
 * show progress incrementally instead of stalling for the whole batch.
 *
 * Authentication is a simple shared bearer token (BENCHMARK_WORKER_SECRET).
 * The worker only ever runs in a private network behind Dokploy's reverse
 * proxy, so this is appropriate for our threat model.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { runInContainer, checkImages } from './docker.js'
import { buildNodeScript } from './runtimes/node.js'
import { buildDenoScript } from './runtimes/deno.js'
import { buildBunScript } from './runtimes/bun.js'

const PORT = Number(process.env.PORT) || 8080
const SHARED_SECRET = process.env.BENCHMARK_WORKER_SECRET || ''
const COLLECT_PERF = process.env.COLLECT_PERF !== '0'

const SCRIPT_BUILDERS = {
  node: buildNodeScript,
  deno: buildDenoScript,
  bun: buildBunScript,
}

const DEFAULT_PROFILES = [
  { label: '1x', resourceLevel: 1, cpus: 0.5, memMb: 256 },
  { label: '2x', resourceLevel: 2, cpus: 1.0, memMb: 512 },
  { label: '4x', resourceLevel: 4, cpus: 1.5, memMb: 1024 },
  { label: '8x', resourceLevel: 8, cpus: 2.0, memMb: 2048 },
]

const DEFAULT_RUNTIMES = ['node', 'deno', 'bun']
const MAX_TIME_MS = 5_000
const PER_RUN_TIMEOUT_MS = 30_000

const app = new Hono()

app.get('/health', async (c) => {
  const images = await checkImages()
  return c.json({ status: 'ok', images, perf: COLLECT_PERF })
})

app.post('/api/run', async (c) => {
  if (SHARED_SECRET) {
    const auth = c.req.header('authorization') || ''
    if (auth !== `Bearer ${SHARED_SECRET}`) {
      return c.json({ error: 'unauthorized' }, 401)
    }
  }

  let body
  try {
    body = await c.req.json()
  } catch (_) {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const { code, setup, teardown } = body
  if (!code || typeof code !== 'string') {
    return c.json({ error: 'code (string) is required' }, 400)
  }

  const timeMs = Math.min(Number(body.timeMs) || 1500, MAX_TIME_MS)
  const runtimes = sanitizeRuntimes(body.runtimes) || DEFAULT_RUNTIMES
  const profiles = sanitizeProfiles(body.profiles) || DEFAULT_PROFILES

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      send({ type: 'start', runtimes, profiles, timeMs })

      const abortCtrl = new AbortController()
      c.req.raw.signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true })

      try {
        for (const runtime of runtimes) {
          for (const profile of profiles) {
            if (abortCtrl.signal.aborted) break

            send({ type: 'progress', runtime, profile: profile.label, status: 'running' })

            const builder = SCRIPT_BUILDERS[runtime]
            const script = builder({ code, setup, teardown, timeMs })

            let outcome
            try {
              outcome = await runInContainer({
                runtime,
                script,
                profile,
                collectPerf: COLLECT_PERF,
                timeoutMs: PER_RUN_TIMEOUT_MS,
                signal: abortCtrl.signal,
              })
            } catch (err) {
              outcome = {
                result: { state: 'errored', error: err.message || String(err), opsPerSec: 0, latency: null, memory: null },
                perfCounters: null,
                durationMs: 0,
                exitCode: -1,
                stderrTail: '',
              }
            }

            send({
              type: 'result',
              runtime,
              profile: profile.label,
              resourceLevel: profile.resourceLevel,
              cpus: profile.cpus,
              memMb: profile.memMb,
              durationMs: outcome.durationMs,
              exitCode: outcome.exitCode,
              perfCounters: outcome.perfCounters,
              stderrTail: outcome.result.state === 'errored' ? outcome.stderrTail : undefined,
              ...outcome.result,
            })
          }
        }

        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', error: err.message || String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})

function sanitizeRuntimes(input) {
  if (!Array.isArray(input)) return null
  const allowed = input.filter(r => SCRIPT_BUILDERS[r])
  return allowed.length > 0 ? allowed : null
}

function sanitizeProfiles(input) {
  if (!Array.isArray(input)) return null
  const cleaned = input
    .map(p => ({
      label: String(p.label || ''),
      resourceLevel: Number(p.resourceLevel) || 1,
      cpus: Math.max(0.1, Math.min(8, Number(p.cpus) || 1)),
      memMb: Math.max(64, Math.min(8192, Number(p.memMb) || 256)),
    }))
    .filter(p => p.label)
  return cleaned.length > 0 ? cleaned : null
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`jsperf-worker listening on :${info.port}`)
  if (!SHARED_SECRET) {
    console.warn('WARNING: BENCHMARK_WORKER_SECRET not set — endpoints are unauthenticated')
  }
})
