const ASYNC_MARKERS = [
  'deferred.resolve',
  'await ',
  'return new Promise',
]

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

export function isAsyncTest(test) {
  if (test?.async === true) return true
  const code = [
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
    typeof test?.originalCode === 'string' ? test.originalCode : '',
  ].join('\n')
  return ASYNC_MARKERS.some(marker => code.includes(marker))
}

export function testUsesBrowserApis(test, { setup, teardown } = {}) {
  return findBrowserApiUsage(test, { setup, teardown }).length > 0
}

export function findBrowserApiUsage(test, { setup, teardown } = {}) {
  const source = [
    typeof setup === 'string' ? setup : '',
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.originalCode === 'string' ? test.originalCode : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
    typeof teardown === 'string' ? teardown : '',
  ].join('\n')

  return findBrowserApiGlobals(source)
}

export function findBrowserApiGlobals(source) {
  if (typeof source !== 'string' || source.length === 0) return []

  const searchable = stripCommentsAndStrings(source)
  const matches = new Set()

  for (const match of searchable.matchAll(GLOBAL_BROWSER_API_RE)) {
    matches.add(match[1])
  }

  for (const match of searchable.matchAll(DIRECT_BROWSER_API_RE)) {
    matches.add(match[2])
  }

  return [...matches].sort()
}

function stripCommentsAndStrings(source) {
  let out = ''
  let state = 'code'
  let quote = null
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
