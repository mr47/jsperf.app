import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RUNTIME_TARGETS,
  normalizeRuntimeTargets,
  resolveRuntimeTarget,
} from '../../worker/runtime-targets.js'

describe('runtime targets', () => {
  it('keeps unversioned runtimes on local perf-enabled images', () => {
    expect(DEFAULT_RUNTIME_TARGETS.map(t => t.id)).toEqual(['node', 'deno', 'bun'])
    expect(resolveRuntimeTarget('node')).toMatchObject({
      id: 'node',
      runtime: 'node',
      version: null,
      image: 'jsperf-bench-node:latest',
      supportsPerf: true,
      pull: false,
    })
  })

  it('resolves string version targets to official images', () => {
    expect(resolveRuntimeTarget('node@22')).toMatchObject({
      id: 'node@22',
      runtime: 'node',
      version: '22',
      image: 'node:22-bookworm-slim',
      supportsPerf: false,
      pull: true,
    })
    expect(resolveRuntimeTarget('deno@2.5.0').image).toBe('denoland/deno:debian-2.5.0')
    expect(resolveRuntimeTarget('bun@1.3.0').image).toBe('oven/bun:1.3.0-debian')
  })

  it('accepts object form and explicit official tag variants', () => {
    expect(resolveRuntimeTarget({ runtime: 'node', version: '24.11.1-bookworm-slim' }).image)
      .toBe('node:24.11.1-bookworm-slim')
    expect(resolveRuntimeTarget({ runtime: 'deno', version: 'debian-2.5.0' }).image)
      .toBe('denoland/deno:debian-2.5.0')
    expect(resolveRuntimeTarget({ runtime: 'bun', version: '1.3-debian' }).image)
      .toBe('oven/bun:1.3-debian')
  })

  it('drops unsupported runtimes and invalid versions', () => {
    expect(normalizeRuntimeTargets(['node@22', 'ruby@3', 'bun@bad/tag'])).toEqual([
      expect.objectContaining({ id: 'node@22' }),
    ])
  })
})
