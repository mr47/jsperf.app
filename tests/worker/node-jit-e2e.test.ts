import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { __testing } from '../../worker/docker.js'
import { buildNodeScript } from '../../worker/runtimes/node.js'

const TEST_TIMEOUT_MS = 30_000
const KEEP_OUTPUT = process.env.JSPERF_KEEP_NODE_JIT_E2E === '1'

describe('local Node JIT capture e2e', () => {
  let workDir: string | null = null

  afterEach(async () => {
    if (workDir && !KEEP_OUTPUT) await rm(workDir, { recursive: true, force: true })
    workDir = null
  })

  it('collects V8 JIT diagnostics into the same artifact shape as the worker', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'jsperf-node-jit-'))
    const scriptPath = join(workDir, 'bench.js')
    const script = buildNodeScript({
      code: `
let acc = 0;
for (let i = 0; i < 200; i++) {
  acc = ((acc + i) ^ (i << 1)) | 0;
}
return acc;
`,
      setup: '',
      teardown: '',
      timeMs: 700,
      isAsync: false,
      profiling: null,
    })
    await writeFile(scriptPath, script, 'utf8')

    const { stdout, stderr, exitCode } = await runNodeWithJitFlags(scriptPath, workDir)
    const parsed = __testing.parseStdoutResult(stdout)
    expect(exitCode).toBe(0)
    expect(parsed.result).toMatchObject({ state: 'completed' })

    const v8Log = await readV8Log(workDir)
    const diagnosticOutput = [
      __testing.stripJsonResultLines(stdout),
      stderr,
      v8Log ? `--- v8.log ---\n${v8Log}` : '',
    ].filter(Boolean).join('\n\n')

    const artifact = __testing.buildJitArtifact({
      stdout: diagnosticOutput,
      stderr: '',
      runtimeName: 'node',
      truncated: false,
    })

    expect(artifact).toEqual(expect.objectContaining({
      captureMode: 'v8-opt-code',
      source: 'node-v8',
    }))
    expect(artifact?.output.length).toBeGreaterThan(0)
    expect(artifact?.output).toMatch(/(Optimized code|code-creation|trace-opt|TURBOFAN|jsperfUserBenchmark)/i)

    if (KEEP_OUTPUT) {
      await writeFile(join(workDir, 'jit-artifact.txt'), artifact?.output ?? '', 'utf8')
      console.info(`Node JIT e2e output kept in ${workDir}`)
      console.info(JSON.stringify({
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        v8LogBytes: Buffer.byteLength(v8Log),
        artifactBytes: Buffer.byteLength(artifact?.output ?? ''),
        opsPerSec: parsed.result.opsPerSec,
      }, null, 2))
    }
  }, TEST_TIMEOUT_MS)
})

function runNodeWithJitFlags(scriptPath: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const flags = __testing.nodeJitFlags()
    .map((flag: string) => flag === '--logfile=/work/v8.log' ? '--logfile=v8.log' : flag)

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', ...flags, scriptPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', code => resolve({ stdout, stderr, exitCode: code ?? -1 }))
  })
}

async function readV8Log(cwd: string) {
  const files = await readdir(cwd)
  const logFile = files.find(file => file === 'v8.log' || /v8.*\.log$/i.test(file))
  if (!logFile) return ''
  return readFile(join(cwd, logFile), 'utf8')
}
