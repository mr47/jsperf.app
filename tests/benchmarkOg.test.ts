import { describe, expect, it } from 'vitest'

import { benchmarkOgImagePath, benchmarkOgVersion } from '../lib/benchmarkOg'

describe('benchmark OG helpers', () => {
  it('builds a versioned image path for benchmark SEO metadata', () => {
    expect(benchmarkOgImagePath({
      slug: 'array-map-vs-for-loop',
      revision: 2,
      version: 'abc123',
    })).toBe('/api/benchmark-og?slug=array-map-vs-for-loop&revision=2&v=abc123')
  })

  it('uses a stable version for unchanged benchmark preview inputs', () => {
    const pageData = {
      title: 'Array map vs for loop',
      revision: 1,
      published: '2026-04-29T12:00:00.000Z',
      language: 'javascript',
      tests: [
        { title: 'map', code: 'items.map(fn)' },
        { title: 'for', code: 'for (const item of items) fn(item)' },
      ],
    }

    expect(benchmarkOgVersion(pageData)).toBe(benchmarkOgVersion({ ...pageData }))
  })

  it('changes the version when visible benchmark content changes', () => {
    const base = benchmarkOgVersion({
      title: 'Array map vs for loop',
      revision: 1,
      tests: [{ title: 'map', code: 'items.map(fn)' }],
    })

    const changed = benchmarkOgVersion({
      title: 'Array map vs for loop',
      revision: 1,
      tests: [{ title: 'for', code: 'for (const item of items) fn(item)' }],
    })

    expect(changed).not.toBe(base)
  })
})
