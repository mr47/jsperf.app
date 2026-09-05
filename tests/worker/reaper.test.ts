import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  __testing,
  CONTAINER_LABEL,
  markImageUsed,
  parseContainerList,
  parseDockerTimestamp,
  reapStaleWorkDirs,
  selectExpiredImages,
  selectStaleContainers,
} from '../../worker/reaper.js'
import { isManagedPullImage } from '../../worker/runtime-targets.js'

const NOW = Date.parse('2026-09-05T15:00:00Z')

describe('worker reaper: container selection', () => {
  it('parses docker ps CreatedAt timestamps', () => {
    expect(parseDockerTimestamp('2026-09-05 14:58:30 +0000 UTC')).toBe(Date.parse('2026-09-05T14:58:30Z'))
    expect(parseDockerTimestamp('2026-09-05 16:58:30 +0200 CEST')).toBe(Date.parse('2026-09-05T14:58:30Z'))
    expect(parseDockerTimestamp('2026-09-05T14:58:30.123456789Z')).toBe(Date.parse('2026-09-05T14:58:30.123Z'))
    expect(parseDockerTimestamp('garbage')).toBeNull()
    expect(parseDockerTimestamp('')).toBeNull()
  })

  it('parses the tab-separated docker ps listing', () => {
    const list = parseContainerList([
      'abc123\tbench-node-1x-deadbeef\t2026-09-05 14:58:30 +0000 UTC\trunning',
      'def456\tbench-bun-1x-cafebabe\t2026-09-05 14:00:00 +0000 UTC\texited',
      '',
    ].join('\n'))
    expect(list).toEqual([
      { id: 'abc123', name: 'bench-node-1x-deadbeef', createdAt: Date.parse('2026-09-05T14:58:30Z'), state: 'running' },
      { id: 'def456', name: 'bench-bun-1x-cafebabe', createdAt: Date.parse('2026-09-05T14:00:00Z'), state: 'exited' },
    ])
  })

  it('only removes containers older than the longest legal run', () => {
    const fresh = { id: 'a', name: 'fresh', createdAt: NOW - 30_000, state: 'running' }
    const stale = { id: 'b', name: 'stale', createdAt: NOW - 10 * 60_000, state: 'running' }
    const exitedStale = { id: 'c', name: 'exited', createdAt: NOW - 10 * 60_000, state: 'exited' }
    const unknownAge = { id: 'd', name: 'unknown', createdAt: null, state: 'running' }

    const picked = selectStaleContainers([fresh, stale, exitedStale, unknownAge], NOW, 120_000)
    expect(picked.map((c) => c.id)).toEqual(['b', 'c', 'd'])
  })

  it('removes everything when the max age is zero (shutdown sweep)', () => {
    const containers = [
      { id: 'a', name: 'fresh', createdAt: NOW - 1, state: 'running' },
      { id: 'b', name: 'stale', createdAt: NOW - 10 * 60_000, state: 'running' },
    ]
    expect(selectStaleContainers(containers, NOW, 0).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('uses a stable label so containers survive orchestrator restarts', () => {
    expect(CONTAINER_LABEL).toBe('jsperf.worker')
  })
})

describe('worker reaper: image retention', () => {
  afterEach(() => __testing.reset())

  it('only treats on-demand versioned runtime images as prunable', () => {
    expect(isManagedPullImage('node:22-bookworm-slim')).toBe(true)
    expect(isManagedPullImage('denoland/deno:debian-2.1.0')).toBe(true)
    expect(isManagedPullImage('oven/bun:1.2.0-debian')).toBe(true)
    expect(isManagedPullImage('jsperf-bench-node:latest')).toBe(false)
    expect(isManagedPullImage('jsperf-bench-deno:latest')).toBe(false)
    expect(isManagedPullImage('jsperf-bench-bun:latest')).toBe(false)
    expect(isManagedPullImage('postgres:16')).toBe(false)
    expect(isManagedPullImage('node:<none>')).toBe(false)
    expect(isManagedPullImage('node')).toBe(false)
    expect(isManagedPullImage('')).toBe(false)
    expect(isManagedPullImage(null)).toBe(false)
  })

  it('expires images that have not been used within the retention window', () => {
    markImageUsed('node:22-bookworm-slim', NOW - 8 * 24 * 3600_000)
    markImageUsed('oven/bun:1.2.0-debian', NOW - 60_000)
    const expired = selectExpiredImages(__testing.imageLastUsed, NOW, 7 * 24 * 3600_000)
    expect(expired).toEqual(['node:22-bookworm-slim'])
  })

  it('a fresh use resets the clock', () => {
    markImageUsed('node:22-bookworm-slim', NOW - 8 * 24 * 3600_000)
    markImageUsed('node:22-bookworm-slim', NOW)
    expect(selectExpiredImages(__testing.imageLastUsed, NOW, 7 * 24 * 3600_000)).toEqual([])
  })
})

describe('worker reaper: stale work directories', () => {
  let base: string | null = null

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true })
    base = null
  })

  it('removes only old bench-* directories', async () => {
    base = await mkdtemp(join(tmpdir(), 'jsperf-reaper-'))
    const old = join(base, 'bench-node-old')
    const recent = join(base, 'bench-bun-recent')
    const unrelated = join(base, 'keep-me')
    await mkdir(old)
    await mkdir(recent)
    await mkdir(unrelated)
    await writeFile(join(old, 'bench.js'), '// stale', 'utf8')
    const oldTime = new Date(Date.now() - 2 * 3600_000)
    await utimes(old, oldTime, oldTime)
    await utimes(unrelated, oldTime, oldTime)

    const result = await reapStaleWorkDirs({ baseDir: base, maxAgeMs: 15 * 60_000 })
    expect(result).toEqual({ scanned: 2, removed: ['bench-node-old'] })
    expect((await readdir(base)).sort()).toEqual(['bench-bun-recent', 'keep-me'])
  })

  it('tolerates a missing base directory', async () => {
    const result = await reapStaleWorkDirs({ baseDir: join(tmpdir(), 'definitely-missing-jsperf-dir'), maxAgeMs: 1 })
    expect(result).toEqual({ scanned: 0, removed: [] })
  })
})
