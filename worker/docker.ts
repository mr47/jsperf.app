// @ts-nocheck
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
import { DEFAULT_RUNTIME_TARGETS, resolveRuntimeTarget } from './runtime-targets.js'

const ENTRYPOINT_BY_RUNTIME = {
  // --allow-hrtime was removed in Deno 2 (always-on), so we don't pass it.
  node: (file, profiling) => [
    'node',
    '--expose-gc',
    ...(profiling?.v8Jit === true ? nodeJitFlags() : []),
    file,
  ],
  deno: (file, profiling) => [
    'deno',
    'run',
    `--v8-flags=${denoV8Flags(profiling)}`,
    file,
  ],
  bun: (file) => ['bun', 'run', file],
}

const JIT_CAPTURE_MAX_BYTES = 4 * 1024 * 1024
const STDOUT_PARSE_TAIL_BYTES = 256 * 1024
const STDERR_TAIL_BYTES = 500
const FAILURE_STDOUT_TAIL_BYTES = 2000

// Host-visible work directory. We MUST write benchmark scripts here (not
// /tmp inside the orchestrator container) because we bind-mount this path
// into runtime containers via the host Docker daemon — and the host can
// only see paths that exist on the host.
//
// In dev (no compose mount) this falls back to /tmp, which works as long
// as the orchestrator is running directly on the host.
const WORK_DIR_BASE = process.env.WORK_DIR_BASE || '/tmp/jsperf-worker'
const imageReadyPromises = new Map()

let workDirReady = null
async function ensureWorkDirBase() {
  if (!workDirReady) {
    workDirReady = mkdir(WORK_DIR_BASE, { recursive: true, mode: 0o777 })
      .catch(() => {}) // tolerate EEXIST and read-only fs in tests
  }
  return workDirReady
}

export async function prepareRuntimeImages(runtimeTargets) {
  const uniqueTargets = new Map()
  for (const runtime of runtimeTargets || []) {
    const target = resolveRuntimeTarget(runtime)
    if (target?.pull) uniqueTargets.set(target.image, target)
  }
  await Promise.all([...uniqueTargets.values()].map(ensureImageReady))
}

/**
 * Run a generated benchmark script in a fresh Docker container.
 *
 * @param {object} opts
 * @param {'node'|'deno'|'bun'|object} opts.runtime
 * @param {string} opts.script - Generated JS source to execute
 * @param {object} opts.profile - { label, cpus, memMb }
 * @param {object|null} [opts.profiling] - Optional runtime diagnostics flags
 * @param {boolean} [opts.collectPerf=false] - Wrap with `perf stat` if host allows
 * @param {number} [opts.timeoutMs=30000] - Hard wall-clock ceiling for THIS
 *   container. On expiry we send SIGKILL to the docker child process AND
 *   `docker kill <name>` the container itself, in case the docker CLI is
 *   itself stuck. The benchmark script also has its own (lower) TIME_LIMIT
 *   capped at MAX_TIME_MS in server.js — this timer is the safety net
 *   that catches infinite loops INSIDE __benchFn() (where the script's
 *   own elapsed-time check never fires because no iteration completes).
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{result: object, perfCounters: object|null, durationMs: number, exitCode: number, stderrTail: string}>}
 */
export async function runInContainer({
  runtime,
  script,
  profile,
  profiling,
  collectPerf = false,
  timeoutMs = 30_000,
  signal,
}) {
  const target = resolveRuntimeTarget(runtime)
  if (!target) throw new Error(`Unknown runtime: ${runtime}`)
  const image = target.image
  const runtimeName = target.runtime
  const runtimeId = target.id
  const usePerf = collectPerf && target.supportsPerf
  const captureJit = profiling?.v8Jit === true && (runtimeName === 'node' || runtimeName === 'deno')

  await ensureImageReady(target)
  await ensureWorkDirBase()
  const workDir = await mkdtemp(join(WORK_DIR_BASE, `bench-${safeName(runtimeId)}-`))
  const generatedScript = normalizeGeneratedScript(script)
  const scriptFile = `bench.${generatedScript.extension}`
  const scriptPath = join(workDir, scriptFile)
  await writeFile(scriptPath, generatedScript.source, 'utf8')

  const containerName = `bench-${safeName(runtimeId)}-${safeName(profile.label)}-${randomUUID().slice(0, 8)}`

  // Build the runtime invocation, optionally wrapped with `perf stat`.
  // Perf events are written to a known path inside the container so we can
  // mount it back out as part of the bind-mount.
  const runtimeArgs = ENTRYPOINT_BY_RUNTIME[runtimeName](`/work/${scriptFile}`, profiling)
  const innerCmd = usePerf
    ? [
        'perf', 'stat',
        '-x', ',',
        '-e', 'instructions,cycles,cache-misses,branch-misses,page-faults,context-switches',
        '-o', '/work/perf.txt',
        '--', ...runtimeArgs,
      ]
    : runtimeArgs

  // Defense in depth. We isolate the runtime container at four layers so a
  // pathological snippet (infinite loop, fork bomb, FD leak, OOM, network
  // probe) can't escape its budget or affect the host. See the README's
  // "Security model" section for the full rundown.
  const dockerArgs = [
    'run', '--rm',
    '--name', containerName,
    // Network: no namespace beyond loopback. No DNS, no outbound traffic,
    // cannot reach the host or other containers.
    '--network', 'none',
    // CPU + memory: cgroup-enforced. memory-swap == memory disables swap
    // entirely (otherwise a 512MB container could thrash on host swap).
    '--cpus', String(profile.cpus),
    '--memory', `${profile.memMb}m`,
    '--memory-swap', `${profile.memMb}m`,
    // PIDs + FDs: stops fork bombs and FD-leak DOS against the host.
    '--pids-limit', '256',
    '--ulimit', 'nofile=256:256',
    // Filesystem: root is read-only; only /tmp and /work are writable, both
    // size-bounded. /work is the per-run bind mount holding bench.js/bench.ts.
    '--read-only',
    '--tmpfs', '/tmp:size=64m,exec',
    '-v', `${workDir}:/work:rw`,
    // Privilege escalation: blocked. setuid/setgid binaries can't gain extra
    // capabilities even if present in the runtime image.
    '--security-opt', 'no-new-privileges',
  ]

  if (usePerf) {
    dockerArgs.push('--cap-add', 'SYS_PTRACE', '--cap-add', 'PERFMON')
  }

  dockerArgs.push(image, ...innerCmd)

  const start = Date.now()
  let exitCode = -1
  let stdout = ''
  let stdoutTail = ''
  let jitStdout = ''
  let stderr = ''
  let stderrTail = ''
  let jitStderr = ''
  let jitTruncated = false
  let jitLogBytes = 0
  let timedOut = false
  const stdoutResultTracker = createStdoutResultTracker()

  console.info('[docker] starting container', {
    container: containerName,
    runtime: runtimeId,
    image,
    profile: profile.label,
    cpus: profile.cpus,
    memMb: profile.memMb,
    pull: target.pull ? 'preflight' : false,
    perf: usePerf,
    jitCapture: captureJit,
    timeoutMs,
  })

  if (captureJit) {
    console.info('[docker] jit capture enabled', {
      container: containerName,
      runtime: runtimeId,
      image,
      profile: profile.label,
      flags: runtimeName === 'deno' ? denoV8Flags(profiling).split(',') : nodeJitFlags(),
      v8LogPath: '/work/v8.log',
      maxBytes: JIT_CAPTURE_MAX_BYTES,
    })
  }

  try {
    const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

    const onAbort = () => {
      console.warn('[docker] killing container', {
        container: containerName,
        runtime: runtimeId,
        image,
        timedOut,
      })
      try { child.kill('SIGKILL') } catch (_) { /* already gone */ }
      spawn('docker', ['kill', containerName], { stdio: 'ignore' }).on('error', () => {})
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      timedOut = true
      onAbort()
    }, timeoutMs)

    child.stdout.on('data', d => {
      const text = d.toString()
      stdoutResultTracker.push(text)
      if (captureJit) {
        stdoutTail = appendTail(stdoutTail, text, STDOUT_PARSE_TAIL_BYTES)
        const next = appendHead(jitStdout, text, JIT_CAPTURE_MAX_BYTES)
        jitStdout = next.value
        jitTruncated ||= next.truncated
      } else {
        stdout += text
      }
    })
    child.stderr.on('data', d => {
      const text = d.toString()
      if (captureJit) {
        stderrTail = appendTail(stderrTail, text, STDERR_TAIL_BYTES)
        const next = appendHead(jitStderr, text, JIT_CAPTURE_MAX_BYTES)
        jitStderr = next.value
        jitTruncated ||= next.truncated
      } else {
        stderr += text
      }
    })

    exitCode = await new Promise((resolve) => {
      child.once('close', (code) => resolve(code ?? -1))
      child.once('error', () => resolve(-1))
    })

    clearTimeout(timer)
    if (signal) signal.removeEventListener?.('abort', onAbort)

    const durationMs = Date.now() - start
    const parsedStdout = captureJit ? stdoutResultTracker.finish() : parseStdoutResult(stdout)
    const result = parsedStdout.result
    const perfCounters = usePerf ? await readPerfFile(workDir).catch(() => null) : null
    const runtimeStderrTail = captureJit ? stderrTail : stderr.slice(-STDERR_TAIL_BYTES)
    const runtimeStdoutTail = captureJit
      ? appendTail('', stdoutTail, FAILURE_STDOUT_TAIL_BYTES)
      : appendTail('', stdout, FAILURE_STDOUT_TAIL_BYTES)
    if (captureJit) {
      const jitLog = await readJitLogFile(workDir).catch(() => '')
      if (jitLog) {
        jitLogBytes = Buffer.byteLength(jitLog)
        const next = appendHead(jitStdout, `\n\n--- v8.log ---\n${jitLog}`, JIT_CAPTURE_MAX_BYTES)
        jitStdout = next.value
        jitTruncated ||= next.truncated
      }
    }
    const strippedJitStdout = captureJit ? stripJsonResultLines(jitStdout) : ''
    const jitArtifact = captureJit
      ? buildJitArtifact({
          stdout: strippedJitStdout,
          stderr: jitStderr,
          runtimeName,
          truncated: jitTruncated,
        })
      : null

    if (captureJit) {
      const jitLogPayload = {
        container: containerName,
        runtime: runtimeId,
        image,
        profile: profile.label,
        exitCode,
        resultState: result.state,
        parsedResultLineIndex: parsedStdout.resultLineIndex,
        stdoutTailBytes: Buffer.byteLength(stdoutTail),
        rawStdoutBytes: Buffer.byteLength(jitStdout),
        strippedStdoutBytes: Buffer.byteLength(strippedJitStdout),
        rawStderrBytes: Buffer.byteLength(jitStderr),
        stderrTailBytes: Buffer.byteLength(stderrTail),
        v8LogBytes: jitLogBytes,
        artifactBytes: Buffer.byteLength(jitArtifact?.output || ''),
        artifact: Boolean(jitArtifact),
        truncated: jitTruncated,
      }

      if (jitArtifact) {
        console.info('[docker] jit capture artifact built', jitLogPayload)
      } else {
        console.warn('[docker] jit capture produced no artifact', {
          ...jitLogPayload,
          reason: 'empty diagnostic output after benchmark JSON stripping',
        })
      }
    }

    const logPayload = {
      container: containerName,
      runtime: runtimeId,
      image,
      profile: profile.label,
      durationMs,
      exitCode,
      state: result.state,
      opsPerSec: result.opsPerSec || 0,
      perf: Boolean(perfCounters),
    }

    if (exitCode === 0 && result.state !== 'errored') {
      console.info('[docker] finished container', logPayload)
    } else {
      console.warn('[docker] container failed', {
        ...logPayload,
        error: result.error || null,
        parsedResultLineIndex: parsedStdout.resultLineIndex,
        stdoutBytes: captureJit ? null : Buffer.byteLength(stdout),
        stdoutTailBytes: Buffer.byteLength(runtimeStdoutTail),
        stdoutTail: runtimeStdoutTail || null,
        stderrTail: runtimeStderrTail || null,
      })
    }

    return {
      result,
      perfCounters,
      jitArtifact,
      jitArtifactError: captureJit && !jitArtifact ? 'No V8 JIT output was captured for this run' : null,
      durationMs,
      exitCode,
      stderrTail: runtimeStderrTail,
    }
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

function normalizeGeneratedScript(script) {
  if (typeof script === 'string') {
    return { source: script, extension: 'js' }
  }
  const source = typeof script?.source === 'string' ? script.source : ''
  const extension = script?.extension === 'ts' ? 'ts' : 'js'
  return { source, extension }
}

function nodeJitFlags() {
  return [
    '--no-concurrent-recompilation',
    '--trace-opt',
    '--trace-deopt',
    '--print-opt-code',
    '--print-opt-code-filter=jsperfUserBenchmark',
    '--print-opt-source',
    '--code-comments',
    '--print-code-verbose',
    '--log-code',
    '--logfile=/work/v8.log',
  ]
}

function denoV8Flags(profiling) {
  const flags = ['--expose-gc']
  if (profiling?.v8Jit === true) {
    flags.push(
      '--no-concurrent-recompilation',
      '--trace-opt',
      '--trace-deopt',
      '--print-opt-code',
      '--print-opt-code-filter=jsperfUserBenchmark',
      '--print-opt-source',
      '--code-comments',
      '--print-code-verbose',
      '--log-code',
      '--logfile=/work/v8.log',
    )
  }
  return flags.join(',')
}

/**
 * The generated script writes a single JSON line to stdout. If it crashed
 * before reaching that point we won't find one — return an errored stub.
 */
function parseStdoutResult(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return {
      result: { state: 'errored', error: 'No output from runtime', opsPerSec: 0, latency: null, memory: null },
      resultLineIndex: -1,
    }
  }

  const lines = trimmed.split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonLine(lines[i])
    if (parsed.ok) {
      return { result: parsed.value, resultLineIndex: i }
    } else {
      // V8 diagnostics can trail the benchmark result; keep scanning upward.
    }
  }

  return {
    result: { state: 'errored', error: 'Failed to parse runtime output', opsPerSec: 0, latency: null, memory: null },
    resultLineIndex: -1,
  }
}

function createStdoutResultTracker() {
  let bufferedLine = ''
  let result = null
  let hasResult = false
  let hasOutput = false
  let resultLineIndex = -1
  let nonEmptyLineIndex = 0

  function processLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return
    hasOutput = true

    const parsed = parseJsonLine(trimmed)
    if (parsed.ok) {
      result = parsed.value
      hasResult = true
      resultLineIndex = nonEmptyLineIndex
    }
    nonEmptyLineIndex += 1
  }

  return {
    push(chunk) {
      bufferedLine += chunk
      const lines = bufferedLine.split('\n')
      bufferedLine = lines.pop() || ''
      for (const line of lines) processLine(line)
    },
    finish() {
      if (bufferedLine) {
        processLine(bufferedLine)
        bufferedLine = ''
      }
      if (hasResult) return { result, resultLineIndex }
      if (!hasOutput) {
        return {
          result: { state: 'errored', error: 'No output from runtime', opsPerSec: 0, latency: null, memory: null },
          resultLineIndex: -1,
        }
      }
      return {
        result: { state: 'errored', error: 'Failed to parse runtime output', opsPerSec: 0, latency: null, memory: null },
        resultLineIndex: -1,
      }
    },
  }
}

function parseJsonLine(line) {
  const matches = findBenchmarkJsonResults(line.trim())
  const match = matches[matches.length - 1]
  return match ? { ok: true, value: match.value } : { ok: false, value: null }
}

function findBenchmarkJsonResults(text) {
  const matches = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' || !looksLikeJsonObjectStart(text, start)) continue

    const end = findJsonObjectEnd(text, start)
    if (end === -1) continue

    try {
      const value = JSON.parse(text.slice(start, end + 1))
      if (isBenchmarkResultObject(value)) {
        matches.push({ value, start, end: end + 1 })
      }
    } catch (_) {
      // V8 diagnostics can contain source-looking fragments; ignore those.
    }
  }
  return matches
}

function looksLikeJsonObjectStart(text, start) {
  let index = start + 1
  while (/\s/.test(text[index] || '')) index += 1
  return text[index] === '"'
}

function findJsonObjectEnd(text, start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function isBenchmarkResultObject(value) {
  if (!value || typeof value !== 'object') return false
  if (!['completed', 'errored', 'aborted-with-statistics'].includes(value.state)) return false
  return Number.isFinite(value.opsPerSec) && 'latency' in value && 'memory' in value
}

function appendHead(current, chunk, maxBytes) {
  const currentBytes = Buffer.byteLength(current)
  if (currentBytes >= maxBytes) return { value: current, truncated: true }

  const chunkBytes = Buffer.byteLength(chunk)
  if (currentBytes + chunkBytes <= maxBytes) {
    return { value: current + chunk, truncated: false }
  }

  const remaining = Math.max(0, maxBytes - currentBytes)
  return {
    value: current + Buffer.from(chunk).subarray(0, remaining).toString(),
    truncated: true,
  }
}

function appendTail(current, chunk, maxBytes) {
  const combined = current + chunk
  const combinedBytes = Buffer.byteLength(combined)
  if (combinedBytes <= maxBytes) return combined
  return Buffer.from(combined).subarray(combinedBytes - maxBytes).toString()
}

function stripJsonResultLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const matches = findBenchmarkJsonResults(line)
      if (matches.length === 0) return line

      let stripped = line
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i]
        stripped = stripped.slice(0, match.start) + stripped.slice(match.end)
      }
      return stripped
    })
    .filter((line) => line.trim())
    .join('\n')
    .trim()
}

function buildJitArtifact({ stdout, stderr, runtimeName, truncated }) {
  const sections = []
  if (stdout?.trim()) sections.push(stdout.trim())
  if (stderr?.trim()) sections.push(stderr.trim())
  const output = sections.join('\n\n')
  if (!output) return null

  return {
    output,
    captureMode: 'v8-opt-code',
    source: runtimeName === 'deno' ? 'deno-v8' : 'node-v8',
    truncated: Boolean(truncated),
    maxBytes: JIT_CAPTURE_MAX_BYTES,
  }
}

export const __testing = {
  nodeJitFlags,
  denoV8Flags,
  parseStdoutResult,
  createStdoutResultTracker,
  stripJsonResultLines,
  buildJitArtifact,
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

async function readJitLogFile(workDir) {
  const { open } = await import('node:fs/promises')
  const file = await open(join(workDir, 'v8.log'), 'r')
  try {
    const buffer = Buffer.alloc(JIT_CAPTURE_MAX_BYTES)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString()
  } finally {
    await file.close()
  }
}

/**
 * Quick check that the configured Docker images exist locally. Useful as a
 * health endpoint and to fail fast on misconfigured deploys.
 */
export async function checkImages() {
  const status = {}
  for (const target of DEFAULT_RUNTIME_TARGETS) {
    status[target.id] = await imageExists(target.image)
  }
  return status
}

async function ensureImageReady(target) {
  if (!target.pull) return

  let ready = imageReadyPromises.get(target.image)
  if (!ready) {
    ready = ensurePulledImage(target)
      .finally(() => imageReadyPromises.delete(target.image))
    imageReadyPromises.set(target.image, ready)
  }
  return ready
}

async function ensurePulledImage(target) {
  if (await imageExists(target.image)) {
    console.info('[docker] image already present', {
      runtime: target.id,
      image: target.image,
    })
    return
  }

  const start = Date.now()
  console.info('[docker] pulling image', {
    runtime: target.id,
    image: target.image,
  })

  const { code, stderr } = await runDockerCommand(['pull', target.image])
  const durationMs = Date.now() - start
  if (code !== 0) {
    console.error('[docker] image pull failed', {
      runtime: target.id,
      image: target.image,
      durationMs,
      stderrTail: stderr.slice(-500) || null,
    })
    throw new Error(`failed to pull image ${target.image}`)
  }

  console.info('[docker] image pull complete', {
    runtime: target.id,
    image: target.image,
    durationMs,
  })
}

function runDockerCommand(args) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    child.once('error', (err) => resolve({ code: -1, stdout, stderr: stderr || err.message || String(err) }))
  })
}

function imageExists(image) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    child.once('close', (code) => resolve(code === 0))
    child.once('error', () => resolve(false))
  })
}

function safeName(value) {
  return String(value || 'runtime')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'runtime'
}
