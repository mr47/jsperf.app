/**
 * Multi-runtime benchmark engine.
 *
 * Calls a remote worker service (deployed separately on a self-hosted host
 * via Dokploy) which runs the supplied snippet in Node.js, Deno, and Bun
 * inside resource-isolated Docker containers. Returns per-runtime, per-profile
 * results plus optional hardware perf counters.
 *
 * The engine is purely additive: if BENCHMARK_WORKER_URL is not configured
 * it returns null and the rest of the analysis pipeline carries on unchanged.
 */

const DEFAULT_RUNTIMES = ['node', 'deno', 'bun']

const DEFAULT_PROFILES = [
  { label: '1x', resourceLevel: 1, cpus: 0.5, memMb: 256 },
  { label: '2x', resourceLevel: 2, cpus: 1.0, memMb: 512 },
  { label: '4x', resourceLevel: 4, cpus: 1.5, memMb: 1024 },
  { label: '8x', resourceLevel: 8, cpus: 2.0, memMb: 2048 },
]

/**
 * Run a single benchmark snippet across multiple runtimes via the worker.
 *
 * @param {string} code
 * @param {object} opts
 * @param {string} [opts.setup]
 * @param {string} [opts.teardown]
 * @param {number} [opts.timeMs=1500]
 * @param {string[]} [opts.runtimes]
 * @param {Array} [opts.profiles]
 * @param {AbortSignal} [opts.signal]
 * @param {(event: object) => void} [opts.onProgress]
 * @returns {Promise<{ runtimes: object } | null>}
 *   Returns null if the worker is not configured or unreachable. The rest of
 *   the pipeline treats null as "skip this phase, no error".
 */
export async function runMultiRuntime(code, {
  setup,
  teardown,
  timeMs = 1500,
  runtimes = DEFAULT_RUNTIMES,
  profiles = DEFAULT_PROFILES,
  signal,
  onProgress,
} = {}) {
  const workerUrl = process.env.BENCHMARK_WORKER_URL
  if (!workerUrl) return null

  const headers = { 'Content-Type': 'application/json' }
  if (process.env.BENCHMARK_WORKER_SECRET) {
    headers.Authorization = `Bearer ${process.env.BENCHMARK_WORKER_SECRET}`
  }

  let response
  try {
    response = await fetch(`${workerUrl.replace(/\/+$/, '')}/api/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, setup, teardown, timeMs, runtimes, profiles }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    return { unavailable: true, error: `Worker unreachable: ${err.message || String(err)}` }
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    return { unavailable: true, error: `Worker error ${response.status}: ${text.slice(0, 200)}` }
  }

  const accum = {}
  for (const runtime of runtimes) {
    accum[runtime] = { profiles: [], avgOpsPerSec: 0, error: null }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch (_) { continue }
        handleMessage(msg, accum, onProgress)
      }
    }

    if (buffer.trim()) {
      try {
        handleMessage(JSON.parse(buffer), accum, onProgress)
      } catch (_) { /* malformed final line — ignore */ }
    }
  } finally {
    try { reader.releaseLock() } catch (_) { /* noop */ }
  }

  for (const runtime of Object.keys(accum)) {
    const ops = accum[runtime].profiles.map(p => p.opsPerSec).filter(n => n > 0)
    accum[runtime].avgOpsPerSec = ops.length > 0
      ? Math.round(ops.reduce((s, v) => s + v, 0) / ops.length)
      : 0
  }

  return { runtimes: accum }
}

function handleMessage(msg, accum, onProgress) {
  if (msg.type === 'progress' && onProgress) {
    onProgress({ runtime: msg.runtime, profile: msg.profile, status: msg.status })
    return
  }

  if (msg.type !== 'result') return

  const bucket = accum[msg.runtime]
  if (!bucket) return

  bucket.profiles.push({
    label: msg.profile,
    resourceLevel: msg.resourceLevel,
    cpus: msg.cpus,
    memMb: msg.memMb,
    opsPerSec: msg.opsPerSec || 0,
    state: msg.state,
    error: msg.error,
    latency: msg.latency || null,
    memory: msg.memory || null,
    perfCounters: msg.perfCounters || null,
    durationMs: msg.durationMs,
  })

  if (msg.state === 'errored' && !bucket.error) {
    bucket.error = msg.error || 'unknown error'
  }
}
