/**
 * Cleanup for things the worker can lose track of.
 *
 * The happy path already cleans up after itself: `docker run --rm` removes
 * the container, and runInContainer deletes the per-run work directory in a
 * `finally`. This module covers the unhappy paths:
 *
 *   - Orphaned containers. If the orchestrator crashes or is redeployed
 *     mid-run, the runtime containers keep running (killing the docker CLI
 *     does not stop the container) and a `while(true){}` snippet would burn
 *     a CPU forever. Every container we start carries the CONTAINER_LABEL,
 *     so we can find and force-remove anything older than the longest legal
 *     run.
 *   - Stale work directories left behind by a crash between mkdtemp and rm.
 *   - Versioned runtime images (node:22-bookworm-slim, oven/bun:1.2-debian,
 *     ...) pulled on demand. Each is several hundred MB; left unchecked they
 *     fill the host disk. Images not used within the retention window are
 *     removed (never the locally built default images).
 */

import { spawn } from 'node:child_process'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isManagedPullImage } from './runtime-targets.js'

export const CONTAINER_LABEL = 'jsperf.worker'

export type ContainerInfo = {
  id: string
  name: string
  createdAt: number | null
  state: string
}

export type ReapResult = {
  startedAt: number
  durationMs: number
  containers: { scanned: number; removed: string[]; failed: string[] }
  workDirs: { scanned: number; removed: string[] }
  images: { tracked: number; removed: string[]; failed: string[] }
  error: string | null
}

export type ReaperOptions = {
  intervalMs: number
  containerMaxAgeMs: number
  workDirBase: string
  workDirMaxAgeMs: number
  imageRetentionMs: number
}

const imageLastUsed = new Map<string, number>()

/** Record that a pulled (versioned) image was just used for a run. */
export function markImageUsed(image: string, now = Date.now()) {
  if (!image) return
  imageLastUsed.set(image, now)
}

/**
 * `docker ps` prints CreatedAt as `2026-09-05 14:00:00 +0000 UTC`, which
 * Date.parse does not accept. Normalize to ISO-8601.
 */
export function parseDockerTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = String(value).trim()
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?/)
  if (match) {
    const [, date, time, tzHours, tzMinutes = '00'] = match
    const ms = Date.parse(`${date}T${time}${tzHours}:${tzMinutes}`)
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? ms : null
}

export function parseContainerList(output: string): ContainerInfo[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', name = '', createdAt = '', state = ''] = line.split('\t')
      return { id: id.trim(), name: name.trim(), createdAt: parseDockerTimestamp(createdAt), state: state.trim() }
    })
    .filter((entry) => entry.id)
}

/**
 * Pick containers that have outlived the longest legal run. Containers whose
 * creation time cannot be determined are treated as stale: the alternative
 * is leaking them forever, and `docker rm -f` on a healthy in-flight run
 * only costs that one run.
 */
export function selectStaleContainers(containers: ContainerInfo[], now: number, maxAgeMs: number): ContainerInfo[] {
  return containers.filter((container) => {
    if (container.createdAt == null) return true
    return now - container.createdAt > maxAgeMs
  })
}

export function selectExpiredImages(lastUsed: Map<string, number>, now: number, retentionMs: number): string[] {
  const expired: string[] = []
  for (const [image, usedAt] of lastUsed) {
    if (now - usedAt > retentionMs) expired.push(image)
  }
  return expired
}

export async function listLabeledContainers(): Promise<ContainerInfo[]> {
  const { code, stdout, stderr } = await runDocker([
    'ps', '-a',
    '--filter', `label=${CONTAINER_LABEL}=1`,
    '--format', '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.State}}',
  ])
  if (code !== 0) throw new Error(`docker ps failed: ${stderr.trim() || code}`)
  return parseContainerList(stdout)
}

export async function reapOrphanContainers({ maxAgeMs, now = Date.now() }: { maxAgeMs: number; now?: number }) {
  const containers = await listLabeledContainers()
  const stale = selectStaleContainers(containers, now, maxAgeMs)
  const removed: string[] = []
  const failed: string[] = []
  for (const container of stale) {
    const { code } = await runDocker(['rm', '-f', container.id])
    if (code === 0) removed.push(container.name || container.id)
    else failed.push(container.name || container.id)
  }
  if (removed.length || failed.length) {
    console.warn('[reaper] removed orphaned containers', { removed, failed, maxAgeMs })
  }
  return { scanned: containers.length, removed, failed }
}

export async function reapStaleWorkDirs({ baseDir, maxAgeMs, now = Date.now() }: { baseDir: string; maxAgeMs: number; now?: number }) {
  let entries: string[] = []
  try {
    entries = await readdir(baseDir)
  } catch (_) {
    return { scanned: 0, removed: [] as string[] }
  }
  const candidates = entries.filter((entry) => entry.startsWith('bench-'))
  const removed: string[] = []
  for (const entry of candidates) {
    const path = join(baseDir, entry)
    try {
      const info = await stat(path)
      if (!info.isDirectory() || now - info.mtimeMs <= maxAgeMs) continue
      await rm(path, { recursive: true, force: true })
      removed.push(entry)
    } catch (_) {
      // Vanished between readdir and stat, or already being removed.
    }
  }
  if (removed.length) console.warn('[reaper] removed stale work directories', { removed, baseDir })
  return { scanned: candidates.length, removed }
}

/**
 * Seed the usage map with pulled images already on the host (from a
 * previous worker instance) so they age out too, then remove everything
 * unused for longer than the retention window. `docker rmi` without -f
 * refuses to remove an image with a live container, which is what we want.
 */
export async function reapUnusedImages({ retentionMs, now = Date.now() }: { retentionMs: number; now?: number }) {
  const { code, stdout } = await runDocker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])
  if (code === 0) {
    for (const line of stdout.split('\n')) {
      const ref = line.trim()
      if (!ref || !isManagedPullImage(ref)) continue
      if (!imageLastUsed.has(ref)) imageLastUsed.set(ref, now)
    }
  }

  const removed: string[] = []
  const failed: string[] = []
  for (const image of selectExpiredImages(imageLastUsed, now, retentionMs)) {
    const result = await runDocker(['rmi', image])
    if (result.code === 0) {
      removed.push(image)
      imageLastUsed.delete(image)
    } else if (/No such image/i.test(result.stderr)) {
      imageLastUsed.delete(image)
    } else {
      failed.push(image)
      // Keep it tracked but bump so we retry on a later sweep rather than
      // every interval.
      imageLastUsed.set(image, now - retentionMs / 2)
    }
  }
  if (removed.length || failed.length) {
    console.info('[reaper] pruned unused runtime images', { removed, failed, retentionMs })
  }
  return { tracked: imageLastUsed.size, removed, failed }
}

let lastResult: ReapResult | null = null
let sweeping: Promise<ReapResult> | null = null
let sweeps = 0
let timer: NodeJS.Timeout | null = null

export async function runReaperSweep(options: ReaperOptions): Promise<ReapResult> {
  if (sweeping) return sweeping
  const startedAt = Date.now()
  sweeping = (async () => {
    const result: ReapResult = {
      startedAt,
      durationMs: 0,
      containers: { scanned: 0, removed: [], failed: [] },
      workDirs: { scanned: 0, removed: [] },
      images: { tracked: imageLastUsed.size, removed: [], failed: [] },
      error: null,
    }
    try {
      result.containers = await reapOrphanContainers({ maxAgeMs: options.containerMaxAgeMs, now: startedAt })
    } catch (err) {
      result.error = (err as Error)?.message || String(err)
      console.warn('[reaper] container sweep failed', { error: result.error })
    }
    result.workDirs = await reapStaleWorkDirs({ baseDir: options.workDirBase, maxAgeMs: options.workDirMaxAgeMs, now: startedAt })
    try {
      result.images = await reapUnusedImages({ retentionMs: options.imageRetentionMs, now: startedAt })
    } catch (err) {
      result.error = result.error || (err as Error)?.message || String(err)
      console.warn('[reaper] image sweep failed', { error: (err as Error)?.message || String(err) })
    }
    result.durationMs = Date.now() - startedAt
    lastResult = result
    sweeps += 1
    return result
  })().finally(() => { sweeping = null })
  return sweeping
}

/** Start the periodic sweep. The first sweep runs immediately on boot. */
export function startReaper(options: ReaperOptions) {
  stopReaper()
  void runReaperSweep(options).catch(() => {})
  timer = setInterval(() => { void runReaperSweep(options).catch(() => {}) }, options.intervalMs)
  timer.unref?.()
  return timer
}

export function stopReaper() {
  if (timer) clearInterval(timer)
  timer = null
}

export function getReaperStatus() {
  return {
    sweeps,
    trackedImages: imageLastUsed.size,
    lastSweepAt: lastResult?.startedAt ?? null,
    lastSweep: lastResult
      ? {
          durationMs: lastResult.durationMs,
          containersScanned: lastResult.containers.scanned,
          containersRemoved: lastResult.containers.removed.length,
          workDirsRemoved: lastResult.workDirs.removed.length,
          imagesRemoved: lastResult.images.removed.length,
          error: lastResult.error,
        }
      : null,
  }
}

export const __testing = {
  imageLastUsed,
  reset() {
    imageLastUsed.clear()
    lastResult = null
    sweeps = 0
    stopReaper()
  },
}

function runDocker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    child.once('error', (err) => resolve({ code: -1, stdout, stderr: stderr || err.message }))
  })
}
