import { beforeEach, describe, expect, it, vi } from 'vitest'

const getJobMock = vi.hoisted(() => vi.fn())
const multiRuntimeFindMock = vi.hoisted(() => vi.fn())
const multiRuntimeUpdateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))
const cpuProfileUpdateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))
const jitArtifactUpdateOneMock = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })))

vi.mock('../../lib/engines/multiruntime', () => ({
  getMultiRuntimeJob: (...args: unknown[]) => getJobMock(...args),
}))

vi.mock('../../lib/mongodb', () => ({
  multiRuntimeAnalysesCollection: vi.fn(async () => ({
    find: (...args: unknown[]) => multiRuntimeFindMock(...args),
    updateOne: (...args: unknown[]) => multiRuntimeUpdateOneMock(...args),
  })),
  cpuProfilesCollection: vi.fn(async () => ({
    updateOne: (...args: unknown[]) => cpuProfileUpdateOneMock(...args),
  })),
  jitArtifactsCollection: vi.fn(async () => ({
    updateOne: (...args: unknown[]) => jitArtifactUpdateOneMock(...args),
  })),
}))

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
}))

import { prepareDeepAnalysisRequest } from '../../lib/benchmark/deepAnalysis'
import { getShapedMultiRuntimeJob } from '../../lib/multiRuntimeJobResult'
import { parseOptimizedBlocks } from '../../utils/jitSourceMap'

const SYNTHETIC_COMMERCE_BENCHMARK = {
  language: 'javascript',
  runtimes: [
    { runtime: 'node', version: '24.x' },
    { runtime: 'deno', version: '2.x' },
    { runtime: 'bun', version: '1.x' },
  ],
  profiling: { nodeCpu: true, v8Jit: true },
  setup: `
const tenants = Array.from({ length: 12 }, (_, tenantId) => ({
  tenantId,
  riskFloor: (tenantId % 5) + 1,
}))

const orders = Array.from({ length: 256 }, (_, i) => ({
  tenantId: i % tenants.length,
  sku: 'sku-' + (i % 64),
  quantity: (i % 7) + 1,
  priceCents: 199 + ((i * 17) % 2900),
  tags: i % 11 === 0 ? ['priority', 'cold-start'] : ['standard'],
}))

const routingBySku = new Map(orders.map((order, index) => [order.sku, index % 8]))
const weights = new Float64Array([1.13, 0.97, 1.41, 0.88, 1.05, 1.22, 0.79, 1.34])
const fallbackTags = new Set(['standard'])
const mixedOrders = orders.map((order, index) => index % 3 === 0
  ? { ...order, coupon: 'SAVE' + (index % 5), tags: new Set(order.tags) }
  : index % 3 === 1
    ? {
      tenant: order.tenantId,
      sku: order.sku,
      quantity: String(order.quantity),
      priceCents: order.priceCents,
      tags: order.tags,
    }
    : Object.create(null, {
      sku: { value: order.sku, enumerable: true },
      quantity: { value: order.quantity, enumerable: true },
      priceCents: { value: order.priceCents, enumerable: true },
      tags: { value: null, enumerable: true },
    }))

let checksum = 0

function normalizePolymorphic(order) {
  const quantity = typeof order.quantity === 'string' ? Number(order.quantity) : order.quantity
  const tags = order.tags instanceof Set ? order.tags : new Set(order.tags || fallbackTags)
  const route = routingBySku.get(order.sku) ?? 0
  return ((quantity || 0) * (order.priceCents || 0) * weights[route]) + (tags.has('priority') ? 17 : 3)
}
`,
  tests: [
    {
      title: 'Indexed order scoring (monomorphic Map + typed array)',
      code: `
let total = 0
for (let i = 0; i < orders.length; i++) {
  const order = orders[i]
  const route = routingBySku.get(order.sku) ?? 0
  total += ((order.quantity * order.priceCents * weights[route]) + route) | 0
}
checksum = (checksum ^ total) | 0
return checksum
`,
    },
    {
      title: 'Polymorphic order normalization (mixed shapes + Set tags)',
      code: `
let total = 0
for (let i = 0; i < mixedOrders.length; i++) {
  const order = mixedOrders[i]
  const tags = order.tags instanceof Set ? order.tags : fallbackTags
  total += normalizePolymorphic(order) + (tags.has('priority') ? 1 : 0)
}
checksum = (checksum + total) | 0
return checksum
`,
    },
  ],
}

const CASES = [
  {
    fastestRuntime: 'node@24.1.0',
    nodeOps: 240_000,
    denoOps: 184_000,
    bunOps: 212_000,
    jitSnippets: ['const route = routingBySku.get(order.sku) ?? 0', 'total += ((order.quantity'],
    profileLeaf: 'scoreIndexedOrders',
  },
  {
    fastestRuntime: 'bun@1.2.0',
    nodeOps: 82_000,
    denoOps: 91_000,
    bunOps: 126_000,
    jitSnippets: ['const tags = order.tags instanceof Set', 'total += normalizePolymorphic(order)'],
    profileLeaf: 'normalizeMixedOrders',
  },
]

describe('synthetic benchmark system coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    multiRuntimeFindMock.mockReturnValue({ toArray: vi.fn(async () => []) })
  })

  it('prepares two realistic cases and wires CPU profiles plus JIT source maps through multi-runtime results', async () => {
    const session = expectPreparedRequest(SYNTHETIC_COMMERCE_BENCHMARK)
    const withoutProfiling = expectPreparedRequest({
      ...SYNTHETIC_COMMERCE_BENCHMARK,
      profiling: { nodeCpu: false, v8Jit: false },
    })

    expect(session.prepared.original.tests.map(test => test.title)).toEqual([
      'Indexed order scoring (monomorphic Map + typed array)',
      'Polymorphic order normalization (mixed shapes + Set tags)',
    ])
    expect(session.multiRuntimeOptions).toEqual({
      runtimes: SYNTHETIC_COMMERCE_BENCHMARK.runtimes,
      profiling: { nodeCpu: true, v8Jit: true },
    })
    expect(session.multiRuntimeCacheKey).not.toBe(withoutProfiling.multiRuntimeCacheKey)

    const payloads = []
    for (let testIndex = 0; testIndex < SYNTHETIC_COMMERCE_BENCHMARK.tests.length; testIndex++) {
      getJobMock.mockResolvedValueOnce({
        state: 'done',
        result: { runtimes: makeWorkerRuntimes(testIndex) },
      })

      const shaped = await getShapedMultiRuntimeJob(`synthetic-${testIndex}`, {
        cacheKey: session.multiRuntimeCacheKey,
        testIndex,
      })
      const payload = expectDonePayload(shaped.payload)
      payloads.push(payload)

      const nodeProfile = payload.runtimes['node@24.1.0'].profiles[0]
      expect(payload.runtimeComparison).toMatchObject({
        available: true,
        fastestRuntime: CASES[testIndex].fastestRuntime,
      })
      expect(nodeProfile.cpuProfile).toBeUndefined()
      expect(nodeProfile.jitArtifact).toBeUndefined()
      expect(nodeProfile.cpuProfileRef).toEqual(expect.objectContaining({
        format: 'cpuprofile',
        runtime: 'node@24.1.0',
        runtimeName: 'node',
        sampleCount: 3,
        focusedSampleCount: 2,
      }))
      expect(nodeProfile.jitArtifactRef).toEqual(expect.objectContaining({
        format: 'txt',
        language: 'x86asm',
        runtime: 'node@24.1.0',
        runtimeName: 'node',
        captureMode: 'v8-opt-code',
        truncated: false,
      }))
    }

    expect(payloads.map(payload => payload.runtimeComparison.fastestRuntime)).toEqual([
      'node@24.1.0',
      'bun@1.2.0',
    ])

    const cpuWrites = cpuProfileUpdateOneMock.mock.calls.map((call: any[]) => call[1].$set)
    expect(cpuWrites).toHaveLength(2)
    expect(cpuWrites).toEqual([
      expect.objectContaining({
        testIndex: 0,
        runtime: 'node@24.1.0',
        focusedCpuProfile: expect.objectContaining({
          samples: [3, 3],
          jsPerfFocus: expect.objectContaining({
            mode: 'user-code',
            rawSampleCount: 3,
            droppedSampleCount: 1,
          }),
        }),
        meta: expect.objectContaining({
          format: 'cpuprofile',
          sampleCount: 3,
          focusedSampleCount: 2,
        }),
      }),
      expect.objectContaining({
        testIndex: 1,
        runtime: 'node@24.1.0',
        focusedCpuProfile: expect.objectContaining({
          samples: [3, 3],
          jsPerfFocus: expect.objectContaining({
            rawSampleCount: 3,
            droppedSampleCount: 1,
          }),
        }),
        meta: expect.objectContaining({
          sampleCount: 3,
          focusedSampleCount: 2,
        }),
      }),
    ])

    const jitWrites = jitArtifactUpdateOneMock.mock.calls.map((call: any[]) => call[1].$set)
    expect(jitWrites).toHaveLength(2)
    expect(jitWrites.map(write => write.meta.scenario)).toEqual(SYNTHETIC_COMMERCE_BENCHMARK.tests.map(test => test.title))
    expect(jitWrites.every(write => write.meta.lineCount > 12)).toBe(true)

    const optimizedBlocks = jitWrites.flatMap(write => parseOptimizedBlocks(write.output))
    expect(optimizedBlocks).toHaveLength(2)
    expect(optimizedBlocks.every(block => block.hasPreciseSourceMap)).toBe(true)
    expect(optimizedBlocks[0].source).toContain('routingBySku.get')
    expect(optimizedBlocks[1].source).toContain('normalizePolymorphic(order)')
    expect(optimizedBlocks[0].mappedRanges.reduce((sum, range) => sum + range.instructionCount, 0)).toBeGreaterThan(0)
    expect(optimizedBlocks[1].mappedRanges.reduce((sum, range) => sum + range.instructionCount, 0)).toBeGreaterThan(0)

    expect(multiRuntimeUpdateOneMock).toHaveBeenCalledTimes(2)
    expect(multiRuntimeUpdateOneMock.mock.calls[0][1].$set.runtimes['node@24.1.0'].profiles[0]).toEqual(
      expect.objectContaining({
        cpuProfileRef: expect.any(Object),
        jitArtifactRef: expect.any(Object),
      }),
    )
  })
})

function expectPreparedRequest(body: Record<string, unknown>) {
  const result = prepareDeepAnalysisRequest(body)
  if ('error' in result) {
    throw new Error(`Expected benchmark request to be valid: ${JSON.stringify(result.error)}`)
  }
  return result
}

function expectDonePayload(payload: Awaited<ReturnType<typeof getShapedMultiRuntimeJob>>['payload']) {
  expect(payload).toMatchObject({ state: 'done' })
  if (payload.state !== 'done') throw new Error(`Expected done payload, received ${payload.state}`)
  return payload
}

function makeWorkerRuntimes(testIndex: number) {
  const testCase = CASES[testIndex]
  const test = SYNTHETIC_COMMERCE_BENCHMARK.tests[testIndex]

  return {
    'node@24.1.0': {
      runtime: 'node',
      version: '24.1.0',
      label: 'Node.js 24',
      profiles: [makeProfile({
        label: '1x',
        opsPerSec: testCase.nodeOps,
        runtimeBias: 1,
        cpuProfile: makeCpuProfile(testCase.profileLeaf),
        jitArtifact: {
          output: makeJitArtifactOutput(test.code, test.title, testCase.jitSnippets, testIndex),
          captureMode: 'v8-opt-code',
          source: 'node-v8',
          truncated: false,
          maxBytes: 1024 * 1024,
          meta: { scenario: test.title },
        },
      })],
    },
    'deno@2.4.0': {
      runtime: 'deno',
      version: '2.4.0',
      label: 'Deno 2',
      profiles: [makeProfile({
        label: '1x',
        opsPerSec: testCase.denoOps,
        runtimeBias: 2,
      })],
    },
    'bun@1.2.0': {
      runtime: 'bun',
      version: '1.2.0',
      label: 'Bun 1',
      profiles: [makeProfile({
        label: '1x',
        opsPerSec: testCase.bunOps,
        runtimeBias: 3,
      })],
    },
  }
}

function makeProfile({
  label,
  opsPerSec,
  runtimeBias,
  cpuProfile,
  jitArtifact,
}: {
  label: string
  opsPerSec: number
  runtimeBias: number
  cpuProfile?: Record<string, unknown>
  jitArtifact?: Record<string, unknown>
}) {
  const cycles = Math.round(1_000_000_000 / Math.max(1, runtimeBias))
  return {
    label,
    resourceLevel: 1,
    state: 'completed',
    opsPerSec,
    latency: {
      mean: 1 / opsPerSec,
      p50: 0.8 / opsPerSec,
      p95: 1.3 / opsPerSec,
      p99: 1.8 / opsPerSec,
    },
    memory: {
      after: {
        rss: 64 * 1024 * 1024 + runtimeBias * 1024 * 1024,
        heapUsed: 18 * 1024 * 1024 + runtimeBias * 512 * 1024,
      },
    },
    perfCounters: {
      cycles,
      instructions: Math.round(cycles * (1.8 + runtimeBias / 10)),
      'cache-misses': 12_000 * runtimeBias,
      'branch-misses': 900 * runtimeBias,
    },
    methodology: {
      timeMs: 1500,
      warmupMs: 250,
      profiling: Boolean(cpuProfile || jitArtifact),
    },
    ...(cpuProfile ? { cpuProfile } : {}),
    ...(jitArtifact ? { jitArtifact } : {}),
  }
}

function makeCpuProfile(leafName: string) {
  return {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2] },
      { id: 2, callFrame: { functionName: 'runBenchmark', url: 'node:jsperf-worker' }, children: [3, 5] },
      { id: 3, callFrame: { functionName: 'jsperfUserBenchmark', url: 'jsperf-user-code.js' }, children: [4] },
      { id: 4, callFrame: { functionName: leafName, url: 'jsperf-user-code.js' } },
      { id: 5, callFrame: { functionName: 'hrtime', url: 'node:internal/perf_hooks' } },
    ],
    samples: [4, 5, 4],
    timeDeltas: [900, 300, 900],
    startTime: 1000,
    endTime: 3100,
  }
}

function makeJitArtifactOutput(code: string, title: string, snippets: string[], testIndex: number) {
  const rawSource = `() {\n${indent(code.trim())}\n}`
  const functionStart = 200 + testIndex * 100
  const sourcePositions = snippets.map((snippet, index) => ({
    pcOffset: index * 8,
    sourcePosition: functionStart + rawSource.indexOf(snippet),
  }))

  return [
    `--- FUNCTION SOURCE ([eval]:jsperfUserBenchmark) id{${10 + testIndex},-1} start{${functionStart}} ---`,
    rawSource,
    '--- END ---',
    '--- Raw source ---',
    rawSource,
    '',
    '--- Optimized code ---',
    `optimization_id = ${10 + testIndex}`,
    `source_position = ${functionStart + rawSource.indexOf(snippets[0])}`,
    'kind = TURBOFAN_JS',
    'name = jsperfUserBenchmark',
    'compiler = turbofan',
    '',
    'Instructions (size = 96)',
    '0x1000     0  55             push rbp',
    '0x1004     4  4889e5         mov rbp,rsp',
    '0x1008     8  488b45f8       mov rax,[rbp-0x8]',
    '0x100c     c  4803c1         add rax,rcx',
    '0x1010    10  c3             ret',
    '',
    'Source positions:',
    ' pc offset  position',
    ...sourcePositions.map(entry => `        ${entry.pcOffset.toString(16)}        ${entry.sourcePosition}`),
    '',
    'Inlined functions (count = 0)',
    '',
    '--- End code ---',
    `# ${title}`,
  ].join('\n')
}

function indent(value: string) {
  return value.split('\n').map(line => `  ${line}`).join('\n')
}
