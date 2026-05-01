import { describe, expect, it } from 'vitest'

import { runQuickJSAnalysis } from '../../runtimes/quickjs.js'

describe('worker QuickJS runner', () => {
  it('returns app-compatible unsupported profiles for async snippets', async () => {
    const profiles = await runQuickJSAnalysis([
      { code: 'await Promise.resolve(1)', title: 'async test', async: true },
    ], { timeMs: 10 })

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toHaveLength(4)
    expect(profiles[0][0]).toMatchObject({
      label: '0.5x',
      resourceLevel: 0.5,
      memoryMB: 8,
      opsPerSec: 0,
      state: 'unsupported',
    })
  })
})
