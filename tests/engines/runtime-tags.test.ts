// @ts-nocheck
import { describe, expect, it } from 'vitest'

import {
  buildRuntimeOptions,
  summarizeRuntimeTags,
} from '../../lib/engines/runtime-tags'

describe('runtime tag summaries', () => {
  it('extracts latest and previous stable versions from Docker tags', () => {
    const summary = summarizeRuntimeTags('bun', [
      { name: 'latest', last_updated: '2026-04-25T00:00:00Z' },
      { name: '1.3.1-debian' },
      { name: '1.3.0-debian' },
      { name: '1.2.99-debian' },
    ])

    expect(summary.latestStable).toBe('1.3.1')
    expect(summary.previousStable).toBe('1.3.0')
    expect(summary.availableStable.slice(0, 3)).toEqual(['1.3.1', '1.3.0', '1.2.99'])
  })

  it('understands Deno debian-prefixed tags', () => {
    const summary = summarizeRuntimeTags('deno', [
      { name: 'debian-2.5.0' },
      { name: 'debian-2.4.5' },
    ])

    expect(summary.latestStable).toBe('2.5.0')
    expect(summary.previousStable).toBe('2.4.5')
  })

  it('builds defaults for Node LTS/latest and latest Deno/Bun', () => {
    const options = buildRuntimeOptions({
      node: summarizeRuntimeTags('node', [
        { name: 'lts', last_updated: '2026-04-20T00:00:00Z' },
        { name: '24.11.1' },
        { name: '24.11.0' },
      ]),
      deno: summarizeRuntimeTags('deno', [
        { name: 'debian-2.5.0' },
        { name: 'debian-2.4.5' },
      ]),
      bun: summarizeRuntimeTags('bun', [
        { name: '1.3.0-debian' },
        { name: '1.2.9-debian' },
      ]),
    })

    expect(options.filter(o => o.default).map(o => o.target)).toEqual([
      'node@lts',
      'node@24.11.1',
      'deno@2.5.0',
      'bun@1.3.0',
    ])
    expect(options.some(o => o.target === 'bun@1.2.9' && o.kind === 'previous')).toBe(true)
  })
})
