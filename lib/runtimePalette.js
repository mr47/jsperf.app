const FALLBACK_RUNTIME_META = {
  key: 'runtime',
  label: 'Runtime',
  engine: 'JS',
  text: 'text-violet-600 dark:text-violet-400',
  bar: 'bg-violet-500',
  dot: 'bg-violet-500',
  hex: '#8b5cf6',
  order: 99,
}

const RUNTIME_META = {
  node: {
    key: 'node',
    label: 'Node.js',
    engine: 'V8',
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    hex: '#10b981',
    order: 0,
  },
  'node-gil': {
    key: 'node-gil',
    label: 'Node GIL',
    engine: 'V8',
    text: 'text-teal-600 dark:text-teal-400',
    bar: 'bg-teal-500',
    dot: 'bg-teal-500',
    hex: '#14b8a6',
    order: 1,
  },
  deno: {
    key: 'deno',
    label: 'Deno',
    engine: 'V8',
    text: 'text-sky-600 dark:text-sky-400',
    bar: 'bg-sky-500',
    dot: 'bg-sky-500',
    hex: '#3b82f6',
    order: 2,
  },
  bun: {
    key: 'bun',
    label: 'Bun',
    engine: 'JSC',
    text: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
    order: 3,
  },
  quickjs: {
    key: 'quickjs',
    label: 'QuickJS',
    engine: 'QuickJS',
    text: 'text-violet-600 dark:text-violet-400',
    bar: 'bg-violet-500',
    dot: 'bg-violet-500',
    hex: '#8b5cf6',
    order: 4,
  },
  v8: {
    key: 'v8',
    label: 'V8',
    engine: 'V8',
    text: 'text-cyan-600 dark:text-cyan-400',
    bar: 'bg-cyan-500',
    dot: 'bg-cyan-500',
    hex: '#06b6d4',
    order: 5,
  },
}

function runtimeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split('@')[0]
}

export function runtimePaletteKey(value) {
  const token = runtimeToken(value)
  if (!token) return null

  // Match variants before their base runtime so "node-gil" does not inherit
  // the plain Node color through a loose "node" substring match.
  if (/^node[-_\s]?gil\b/.test(token)) return 'node-gil'
  if (/^node(?:\.js)?\b/.test(token)) return 'node'
  if (/^deno\b/.test(token)) return 'deno'
  if (/^bun\b/.test(token)) return 'bun'
  if (/^quickjs\b/.test(token)) return 'quickjs'
  if (/^v8\b/.test(token)) return 'v8'

  return token
}

export function runtimePalette(value) {
  const key = runtimePaletteKey(value)
  return RUNTIME_META[key] || { ...FALLBACK_RUNTIME_META, key: key || FALLBACK_RUNTIME_META.key }
}

export function runtimeHexColor(value) {
  return runtimePalette(value).hex
}

export function compareRuntimePalette(a, b) {
  const metaA = runtimePalette(a)
  const metaB = runtimePalette(b)
  if (metaA.order !== metaB.order) return metaA.order - metaB.order
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true })
}

export const BASE_RUNTIME_KEYS = ['node', 'deno', 'bun']
