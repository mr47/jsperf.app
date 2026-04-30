import { formatNumber } from './ArrayUtils'

const RUNTIME_LABELS_FOR_PROMPT: Record<string, string> = {
  node: 'Node.js (V8)',
  deno: 'Deno (V8)',
  bun: 'Bun (JSC)',
}
const RUNTIME_ORDER_FOR_PROMPT = ['node', 'deno', 'bun']

export function generateAIPrompt({
  tests,
  analysis,
  multiRuntimeData,
  multiRuntimeStatus,
  language,
  includeAnalysis = false,
}: {
  tests: any[]
  analysis: any
  multiRuntimeData: any
  multiRuntimeStatus: string
  language: string
  includeAnalysis?: boolean
}) {
  const resultsText = tests
    .map((t, idx) => `Test ${idx + 1} (${t.title}): ${t.opsPerSec ? formatNumber(Math.round(t.opsPerSec)) : 'Error or Infinity'} ops/sec`)
    .join('\n')

  const codeText = tests
    .map((t, idx) => `--- Test ${idx + 1} (${t.title}) ---\n${t.code}`)
    .join('\n\n')

  let analysisSection = ''
  if (includeAnalysis && analysis?.results) {
    const serverResults = analysis.results.map((r: any) => {
      const chars = r.prediction?.characteristics || {}
      const activeChars = Object.entries(chars)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ')

      return [
        `--- Test ${r.testIndex + 1} (${r.title}) ---`,
        `  QuickJS (interpreter): ${formatNumber(Math.round(r.quickjs.opsPerSec))} ops/sec`,
        `  V8 (JIT):              ${formatNumber(Math.round(r.v8.opsPerSec))} ops/sec`,
        r.complexity ? `  Static Complexity:    time ${r.complexity.time?.notation || 'unknown'}, space ${r.complexity.space?.notation || 'unknown'}${r.complexity.async?.mode && r.complexity.async.mode !== 'none' ? `, async ${r.complexity.async.mode}` : ''}` : null,
        r.complexity?.explanation ? `  Complexity Notes:     ${r.complexity.explanation}` : null,
        `  JIT Amplification:     ${r.prediction?.jitBenefit ?? 'N/A'}x`,
        `  Memory Response:       ${r.prediction?.scalingType ?? 'N/A'} (fit quality: ${r.prediction?.scalingConfidence != null ? (r.prediction.scalingConfidence * 100).toFixed(0) + '%' : 'N/A'})`,
        `  Memory Sensitivity:    ${r.prediction?.memSensitivity ?? 'N/A'}`,
        activeChars ? `  Characteristics:       ${activeChars}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n\n')

    const comp = analysis.comparison
    const divergenceNote = comp?.divergence
      ? 'Note: The algorithmically fastest snippet (by interpreter) differs from the runtime fastest (by V8 JIT). The winner is determined by JIT optimization, not algorithm.'
      : 'The algorithmic ranking (interpreter) and runtime ranking (V8 JIT) agree.'

    analysisSection = `

### Deep Analysis (Server-Side Controlled Environment):
These results come from isolated server runs — QuickJS-WASM provides a deterministic interpreter baseline and memory-limit sweep; V8 runs once in a single-vCPU Firecracker microVM for realistic canonical JIT profiling.

${serverResults}

${divergenceNote}`

    const multiRuntimeSection = formatMultiRuntimeForPrompt(multiRuntimeData)
    if (multiRuntimeSection) {
      analysisSection += multiRuntimeSection
    }
  }

  const promptHints = []
  if (includeAnalysis) promptHints.push('JIT amplification, memory response, static complexity, characteristics')
  if (includeAnalysis && multiRuntimeStatus === 'done') {
    promptHints.push('cross-runtime variation (Node/Deno/Bun) and hardware perf counters where available')
  }

  const sourceLanguageLabel = language === 'typescript' ? 'TypeScript' : 'JavaScript'
  const prompt = `I ran a ${sourceLanguageLabel} performance benchmark. Please analyze the results and explain why the fastest snippet is faster, focusing on V8/browser engine optimizations.

### Browser Benchmark Results:
${resultsText}

### Code Snippets:
${codeText}${analysisSection}

Why is the fastest snippet performing better in modern JavaScript engines?${language === 'typescript' ? ' Note that some engines may run JavaScript compiled from the original TypeScript source.' : ''}${promptHints.length > 0 ? ` Use the deep analysis data (${promptHints.join('; ')}) to give a more precise explanation.` : ''}`

  return encodeURIComponent(prompt)
}

function formatMultiRuntimeForPrompt(multiRuntimeData: any) {
  const results = multiRuntimeData?.results
  if (!Array.isArray(results) || results.length === 0) return ''

  const ready = results.filter(r => r?.state === 'done' && r.runtimeComparison?.available)
  if (ready.length === 0) return ''

  const blocks = ready.map((r) => {
    const cmp = r.runtimeComparison
    const ordered = [...cmp.runtimes].sort(compareRuntimeForPrompt)

    const runtimeLines = ordered.map((rt) => {
      const p = rt.profiles?.[0] || {}
      const c = p.perfCounters || {}

      const ipc = (c.instructions != null && c.cycles != null && c.cycles > 0)
        ? (c.instructions / c.cycles).toFixed(2)
        : null

      const perfBits = []
      if (ipc != null) perfBits.push(`IPC=${ipc}`)
      if (c.instructions != null) perfBits.push(`instr=${fmtBig(c.instructions)}`)
      if (c['cache-misses'] != null) perfBits.push(`cache-miss=${fmtBig(c['cache-misses'])}`)
      if (c['branch-misses'] != null) perfBits.push(`branch-miss=${fmtBig(c['branch-misses'])}`)

      const perfStr = perfBits.length > 0 ? `; ${perfBits.join(', ')}` : ''
      const opsStr = `${formatNumber(rt.avgOpsPerSec)} ops/s`
      const latStr = `p50=${fmtLatency(p.latencyMean)} p99=${fmtLatency(p.latencyP99)}`
      const memStr = p.rss != null ? ` rss=${fmtBytes(p.rss)}` : ''

      return `    ${runtimeLabelForPrompt(rt)}: ${opsStr}; ${latStr}${memStr}${perfStr}`
    }).join('\n')

    const fastest = runtimeLabelForPrompt(cmp.runtimes.find(rt => rt.runtime === cmp.fastestRuntime) || { runtime: cmp.fastestRuntime })
    const slowest = runtimeLabelForPrompt(cmp.runtimes.find(rt => rt.runtime === cmp.slowestRuntime) || { runtime: cmp.slowestRuntime })
    const spreadLine = (cmp.spread > 1 && fastest && slowest)
      ? `\n    ➜ ${cmp.spread}x throughput spread (fastest: ${fastest}, slowest: ${slowest})`
      : ''

    return `--- Test ${r.testIndex + 1} ---\n${runtimeLines}${spreadLine}`
  }).join('\n\n')

  return `

### Multi-Runtime Comparison (Node.js / Deno / Bun, same isolated single-core CPU+memory budget):
Each runtime ran the same snippet inside its own Docker container with identical resource limits. V8 powers Node and Deno; Bun uses JavaScriptCore. Differences are real engine/runtime effects, not hardware noise.

${blocks}`
}

function compareRuntimeForPrompt(a: any, b: any) {
  const orderA = RUNTIME_ORDER_FOR_PROMPT.indexOf(runtimeBaseForPrompt(a))
  const orderB = RUNTIME_ORDER_FOR_PROMPT.indexOf(runtimeBaseForPrompt(b))
  const normalizedA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA
  const normalizedB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB
  if (normalizedA !== normalizedB) return normalizedA - normalizedB
  return runtimeLabelForPrompt(a).localeCompare(runtimeLabelForPrompt(b), undefined, { numeric: true })
}

function runtimeLabelForPrompt(entry: any) {
  const base = runtimeBaseForPrompt(entry)
  const version = entry?.version || runtimeVersionForPrompt(entry?.runtime)
  const label = RUNTIME_LABELS_FOR_PROMPT[base] || base || entry?.runtime || 'runtime'
  return version ? `${label} ${version}` : label
}

function runtimeBaseForPrompt(entry: any) {
  return (entry?.runtimeName || entry?.runtime || '').split('@')[0]
}

function runtimeVersionForPrompt(runtimeId: unknown) {
  if (typeof runtimeId !== 'string') return null
  const marker = runtimeId.indexOf('@')
  return marker === -1 ? null : runtimeId.slice(marker + 1)
}

function fmtLatency(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a'
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`
  return `${ms.toFixed(2)}ms`
}

function fmtBytes(n: number | null | undefined) {
  if (n == null) return 'n/a'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function fmtBig(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}
