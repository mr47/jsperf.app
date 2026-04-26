import type { BenchmarkTestSource } from './types'

const ASYNC_MARKERS = [
  'deferred.resolve',
  'await ',
  'return new Promise',
]

const PROMISE_LIKE_RE = /\b(?:return\s+)?(?:Promise\.(?:resolve|reject|all|allSettled|race|any)|fetch\s*\(|[^;\n]+?\.(?:then|catch|finally)\s*\()/m
const TIMER_ASYNC_RE = /\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(/
const MUTATING_METHOD_RE = /\.(?:push|pop|shift|unshift|splice|sort|reverse|copyWithin|fill|set|add|delete|clear|append|appendChild|remove|removeChild)\s*\(/
const GLOBAL_WRITE_RE = /\b(?:globalThis|self|window)\s*\.\s*[A-Za-z_$][\w$]*\s*(?:[+\-*/%&|^]?=(?!=|>)|\+\+|--)/
const RETURN_OR_THROW_RE = /\b(?:return|throw)\b/
const NON_DECLARATION_ASSIGNMENT_RE = /(^|[;\n]\s*|[^\w$])(?!(?:const|let|var)\s+)([A-Za-z_$][\w$]*(?:\s*(?:\.|\[)[^=;]+)?)\s*(?:[+\-*/%&|^]?=(?!=|>)|\+\+|--)/
const COMPUTABLE_WORK_RE = /\bnew\s+[A-Za-z_$]|\b[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\(|[+\-*/%&|^]=?|=>/
const SETUP_WORK_RE = /\b(?:Array\.from|new\s+(?:Array|Map|Set|WeakMap|WeakSet|Date|RegExp|URL|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)|JSON\.parse|structuredClone)\s*\(/
const DECLARED_SETUP_WORK_RE = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:Array\.from|new\s+(?:Array|Map|Set|WeakMap|WeakSet)|JSON\.parse|structuredClone|\[[\s\S]{120,}?\]|\{[\s\S]{160,}?\})/
const LARGE_LITERAL_RE = /(?:\[[\s\S]{180,}?\]|\{[\s\S]{240,}?\})/

const BROWSER_API_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'screen',
  'visualViewport',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  'customElements',
  'HTMLElement',
  'HTMLDocument',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'Element',
  'NodeList',
  'DOMParser',
  'XMLSerializer',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'FileReader',
  'Image',
  'Audio',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'alert',
  'confirm',
  'prompt',
]

const BROWSER_API_PATTERN = BROWSER_API_GLOBALS
  .map(escapeRegExp)
  .join('|')

const DIRECT_BROWSER_API_RE = new RegExp(`(^|[^.$\\w])(${BROWSER_API_PATTERN})\\b(?!\\s*:)`, 'g')
const GLOBAL_BROWSER_API_RE = new RegExp(`\\b(?:globalThis|self)\\s*\\.\\s*(${BROWSER_API_PATTERN})\\b`, 'g')

export function isAsyncTest(test?: BenchmarkTestSource | null): boolean {
  if (test?.async === true) return true
  const code = [
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
    typeof test?.originalCode === 'string' ? test.originalCode : '',
  ].join('\n')
  return ASYNC_MARKERS.some(marker => code.includes(marker))
}

export interface BenchmarkSourceRisk {
  evidence: string
}

export function findAsyncNotAwaitedRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  if (isAsyncTest(test)) return null

  const source = primaryTestSource(test)
  if (!source) return null
  const searchable = stripCommentsAndStrings(source)

  if (PROMISE_LIKE_RE.test(searchable)) {
    return { evidence: firstMatchingSnippet(source, PROMISE_LIKE_RE) || 'Promise-like work without an async marker' }
  }
  if (TIMER_ASYNC_RE.test(searchable)) {
    return { evidence: firstMatchingSnippet(source, TIMER_ASYNC_RE) || 'Timer or microtask scheduled inside the measured function' }
  }
  return null
}

export function findDeadCodeEliminationRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const searchable = stripCommentsAndStrings(source)
  if (!COMPUTABLE_WORK_RE.test(searchable)) return null
  if (hasObservableEffect(searchable)) return null

  return {
    evidence: firstMeaningfulLine(source) || 'Snippet appears to compute a value without making it observable',
  }
}

export function findConstantFoldingRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const searchable = stripCommentsAndStrings(source)
  const identifiers = [...searchable.matchAll(/\b[A-Za-z_$][\w$]*\b/g)]
    .map(match => match[0])
    .filter(identifier => !CONSTANT_ALLOWED_IDENTIFIERS.has(identifier))

  const hasLiteralOperator =
    /\bMath\s*\./.test(source) ||
    /(?:\d|true|false|null|undefined|["'`])[\s\S]*[+\-*/%]/.test(source)
  if (identifiers.length === 0 && hasLiteralOperator) {
    return { evidence: firstMeaningfulLine(source) || 'Only literal inputs are visible in the measured expression' }
  }
  return null
}

export function findSetupInMeasuredCodeRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const searchable = stripCommentsAndStrings(source)
  const evidence =
    firstMatchingSnippet(source, DECLARED_SETUP_WORK_RE) ||
    firstMatchingSnippet(source, SETUP_WORK_RE) ||
    firstMatchingSnippet(source, LARGE_LITERAL_RE)

  if (!evidence) return null
  if (/\breturn\b/.test(searchable) && !DECLARED_SETUP_WORK_RE.test(searchable) && !LARGE_LITERAL_RE.test(searchable)) {
    return null
  }

  return { evidence }
}

export function testUsesBrowserApis(
  test?: BenchmarkTestSource | null,
  { setup, teardown }: { setup?: string, teardown?: string } = {},
): boolean {
  return findBrowserApiUsage(test, { setup, teardown }).length > 0
}

export function findBrowserApiUsage(
  test?: BenchmarkTestSource | null,
  { setup, teardown }: { setup?: string, teardown?: string } = {},
): string[] {
  const source = [
    typeof setup === 'string' ? setup : '',
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.originalCode === 'string' ? test.originalCode : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
    typeof teardown === 'string' ? teardown : '',
  ].join('\n')

  return findBrowserApiGlobals(source)
}

export function findBrowserApiGlobals(source: unknown): string[] {
  if (typeof source !== 'string' || source.length === 0) return []

  const searchable = stripCommentsAndStrings(source)
  const matches = new Set<string>()

  for (const match of searchable.matchAll(GLOBAL_BROWSER_API_RE)) {
    matches.add(match[1])
  }

  for (const match of searchable.matchAll(DIRECT_BROWSER_API_RE)) {
    matches.add(match[2])
  }

  return [...matches].sort()
}

export function stripCommentsAndStrings(source: string): string {
  let out = ''
  let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code'
  let quote: string | null = null
  let escaped = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (state === 'line-comment') {
      if (ch === '\n' || ch === '\r') {
        state = 'code'
        out += ch
      } else {
        out += ' '
      }
      continue
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        out += '  '
        i++
        state = 'code'
      } else {
        out += ch === '\n' || ch === '\r' ? ch : ' '
      }
      continue
    }

    if (state === 'string') {
      out += ch === '\n' || ch === '\r' ? ch : ' '
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        state = 'code'
        quote = null
      }
      continue
    }

    if (ch === '/' && next === '/') {
      out += '  '
      i++
      state = 'line-comment'
      continue
    }

    if (ch === '/' && next === '*') {
      out += '  '
      i++
      state = 'block-comment'
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      out += ' '
      state = 'string'
      quote = ch
      escaped = false
      continue
    }

    out += ch
  }

  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const CONSTANT_ALLOWED_IDENTIFIERS = new Set([
  'return',
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'Math',
  'abs',
  'acos',
  'asin',
  'atan',
  'atan2',
  'ceil',
  'cos',
  'floor',
  'imul',
  'log',
  'max',
  'min',
  'pow',
  'round',
  'sign',
  'sin',
  'sqrt',
  'tan',
  'trunc',
])

function primaryTestSource(test?: BenchmarkTestSource | null): string {
  return [
    typeof test?.originalCode === 'string' ? test.originalCode : '',
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
  ].find(value => value.trim().length > 0) || ''
}

function hasObservableEffect(source: string): boolean {
  return (
    RETURN_OR_THROW_RE.test(source) ||
    MUTATING_METHOD_RE.test(source) ||
    GLOBAL_WRITE_RE.test(source) ||
    NON_DECLARATION_ASSIGNMENT_RE.test(source) ||
    /\b(?:console|performance)\s*\./.test(source) ||
    /\bdeferred\s*\.\s*resolve\s*\(/.test(source)
  )
}

function firstMatchingSnippet(source: string, pattern: RegExp): string | null {
  const match = source.match(pattern)
  if (!match) return null
  return cleanSnippet(match[0])
}

function firstMeaningfulLine(source: string): string | null {
  const line = source
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(value => value && !value.startsWith('//'))
  return line ? cleanSnippet(line) : null
}

function cleanSnippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}
