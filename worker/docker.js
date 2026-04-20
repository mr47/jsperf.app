/**
 * Docker container lifecycle for benchmark runs.
 *
 * This is a thin shell-out over the `docker` CLI. We deliberately avoid the
 * dockerode npm dependency: shelling out is simpler to reason about, easier
 * to audit for security, and the worker already needs `docker` installed.
 *
 * For each benchmark run we:
 *   1. Write the generated benchmark script to a temp dir (mounted read-only)
 *   2. `docker run --rm` the appropriate image with strict resource limits
 *   3. Optionally wrap the runtime invocation with `perf stat` to capture
 *      hardware counters when the host kernel allows it
 *   4. Parse the single JSON line written to stdout + the perf-stat block
 *      written to stderr
 */

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const IMAGE_BY_RUNTIME = {
  node: 'jsperf-bench-node:latest',
  deno: 'jsperf-bench-deno:latest',
  bun: 'jsperf-bench-bun:latest',
}

const ENTRYPOINT_BY_RUNTIME = {
  // --allow-hrtime was removed in Deno 2 (always-on), so we don't pass it.
  node: ['node', '--expose-gc', '/work/bench.js'],
  deno: ['deno', 'run', '--v8-flags=--expose-gc', '/work/bench.js'],
  bun: ['bun', 'run', '/work/bench.js'],
}

// Host-visible work directory. We MUST write benchmark scripts here (not
// /tmp inside the orchestrator container) because we bind-mount this path
// into runtime containers via the host Docker daemon — and the host can
// only see paths that exist on the host.
//
// In dev (no compose mount) this falls back to /tmp, which works as long
// as the orchestrator is running directly on the host.
const WORK_DIR_BASE = process.env.WORK_DIR_BASE || '/tmp/jsperf-worker'

let workDirReady = null
async function ensureWorkDirBase() {
  if (!workDirReady) {
    workDirReady = mkdir(WORK_DIR_BASE, { recursive: true, mode: 0o777 })
      .catch(() => {}) // tolerate EEXIST and read-only fs in tests
  }
  return workDirReady
}

/**
 * Run a generated benchmark script in a fresh Docker container.
 *
 * @param {object} opts
 * @param {'node'|'deno'|'bun'} opts.runtime
 * @param {string} opts.script - Generated JS source to execute
 * @param {object} opts.profile - { label, cpus, memMb }
 * @param {boolean} [opts.collectPerf=false] - Wrap with `perf stat` if host allows
 * @param {number} [opts.timeoutMs=30000]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{result: object, perfCounters: object|null, durationMs: number, exitCode: number, stderrTail: string}>}
 */
export async function runInContainer({
  runtime,
  script,
  profile,
  collectPerf = false,
  timeoutMs = 30_000,
  signal,
}) {
  const image = IMAGE_BY_RUNTIME[runtime]
  if (!image) throw new Error(`Unknown runtime: ${runtime}`)

  await ensureWorkDirBase()
  const workDir = await mkdtemp(join(WORK_DIR_BASE, `bench-${runtime}-`))
  const scriptPath = join(workDir, 'bench.js')
  await writeFile(scriptPath, script, 'utf8')

  const containerName = `bench-${runtime}-${profile.label}-${randomUUID().slice(0, 8)}`

  // Build the runtime invocation, optionally wrapped with `perf stat`.
  // Perf events are written to a known path inside the container so we can
  // mount it back out as part of the bind-mount.
  const runtimeArgs = ENTRYPOINT_BY_RUNTIME[runtime]
  const innerCmd = collectPerf
    ? [
        'perf', 'stat',
        '-x', ',',
        '-e', 'instructions,cycles,cache-misses,branch-misses,page-faults,context-switches',
        '-o', '/work/perf.txt',
        '--', ...runtimeArgs,
      ]
    : runtimeArgs

  const dockerArgs = [
    'run', '--rm',
    '--name', containerName,
    '--network', 'none',
    '--cpus', String(profile.cpus),
    '--memory', `${profile.memMb}m`,
    '--memory-swap', `${profile.memMb}m`,
    '--pids-limit', '256',
    '--read-only',
    '--tmpfs', '/tmp:size=64m,exec',
    '-v', `${workDir}:/work:rw`,
    '--security-opt', 'no-new-privileges',
  ]

  if (collectPerf) {
    dockerArgs.push('--cap-add', 'SYS_PTRACE', '--cap-add', 'PERFMON')
  }

  dockerArgs.push(image, ...innerCmd)

  const start = Date.now()
  let exitCode = -1
  let stdout = ''
  let stderr = ''

  try {
    const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

    const onAbort = () => {
      try { child.kill('SIGKILL') } catch (_) { /* already gone */ }
      spawn('docker', ['kill', containerName], { stdio: 'ignore' }).on('error', () => {})
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      onAbort()
    }, timeoutMs)

    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })

    exitCode = await new Promise((resolve) => {
      child.once('close', (code) => resolve(code ?? -1))
      child.once('error', () => resolve(-1))
    })

    clearTimeout(timer)
    if (signal) signal.removeEventListener?.('abort', onAbort)

    const durationMs = Date.now() - start
    const result = parseStdoutResult(stdout)
    const perfCounters = collectPerf ? await readPerfFile(workDir).catch(() => null) : null

    return {
      result,
      perfCounters,
      durationMs,
      exitCode,
      stderrTail: stderr.slice(-500),
    }
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The generated script writes a single JSON line to stdout. If it crashed
 * before reaching that point we won't find one — return an errored stub.
 */
function parseStdoutResult(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { state: 'errored', error: 'No output from runtime', opsPerSec: 0, latency: null, memory: null }
  }

  const lines = trimmed.split('\n').filter(Boolean)
  const lastLine = lines[lines.length - 1]
  try {
    return JSON.parse(lastLine)
  } catch (_) {
    return { state: 'errored', error: 'Failed to parse runtime output', opsPerSec: 0, latency: null, memory: null }
  }
}

/**
 * Parse `perf stat -x ,` CSV output from the bind-mounted file.
 *
 * Each row looks like:
 *   <count>,,<event>,<runtime>,<percentage>
 * with `<not counted>` or `<not supported>` when the kernel can't count it.
 */
async function readPerfFile(workDir) {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(join(workDir, 'perf.txt'), 'utf8')
  const counters = {}

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const cols = trimmed.split(',')
    if (cols.length < 3) continue

    const rawCount = cols[0].trim()
    const eventName = cols[2].trim()
    if (!eventName) continue

    if (rawCount === '<not counted>' || rawCount === '<not supported>' || rawCount === '') {
      counters[eventName] = null
    } else {
      const n = Number(rawCount)
      counters[eventName] = Number.isFinite(n) ? n : null
    }
  }

  return Object.keys(counters).length > 0 ? counters : null
}

/**
 * Quick check that the configured Docker images exist locally. Useful as a
 * health endpoint and to fail fast on misconfigured deploys.
 */
export async function checkImages() {
  const status = {}
  for (const [runtime, image] of Object.entries(IMAGE_BY_RUNTIME)) {
    status[runtime] = await imageExists(image)
  }
  return status
}

function imageExists(image) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    child.once('close', (code) => resolve(code === 0))
    child.once('error', () => resolve(false))
  })
}
