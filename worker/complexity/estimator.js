import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'

const ESTIMATOR_VERSION = 1

const TIME_RANKS = [
  { key: 'constant', notation: 'O(1)', label: 'constant' },
  { key: 'logarithmic', notation: 'O(log n)', label: 'logarithmic' },
  { key: 'linear', notation: 'O(n)', label: 'linear' },
  { key: 'linearithmic', notation: 'O(n log n)', label: 'linearithmic' },
  { key: 'quadratic', notation: 'O(n^2)', label: 'quadratic' },
  { key: 'cubic', notation: 'O(n^3)', label: 'cubic' },
]

const SPACE_RANKS = [
  { key: 'constant', notation: 'O(1)', label: 'constant' },
  { key: 'linear', notation: 'O(n)', label: 'linear' },
  { key: 'quadratic', notation: 'O(n^2)', label: 'quadratic' },
]

const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
])

const LINEAR_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'forEach',
  'find',
  'findLast',
  'some',
  'every',
  'includes',
  'indexOf',
  'lastIndexOf',
  'flat',
  'flatMap',
])

const COPYING_METHODS = new Set([
  'map',
  'filter',
  'flat',
  'flatMap',
  'slice',
  'splice',
  'concat',
  'toReversed',
  'toSpliced',
  'with',
])

const SORT_METHODS = new Set(['sort', 'toSorted'])
const OBJECT_LINEAR_METHODS = new Set(['keys', 'values', 'entries', 'fromEntries'])
const PROMISE_FANOUT_METHODS = new Set(['all', 'allSettled'])
const PROMISE_RACE_METHODS = new Set(['race', 'any'])

let parser

function getParser() {
  if (!parser) {
    parser = new Parser()
    parser.setLanguage(JavaScript)
  }
  return parser
}

export function estimateComplexity(code, { setup = '' } = {}) {
  const source = typeof code === 'string' ? code : ''
  const setupSource = typeof setup === 'string' ? setup : ''
  const setupContext = collectSetupContext(setupSource)
  const parsed = parseSnippet(source)

  const state = {
    timeRank: 0,
    spaceRank: 0,
    signals: new Set(),
    explanations: [],
    confidencePenalty: 0,
    loopDepth: 0,
    functionStack: [],
    async: {
      hasAwait: false,
      awaitInLoop: false,
      hasAsyncIteration: false,
      hasFanout: false,
      hasRace: false,
      hasArrayFromAsync: false,
      notes: new Set(),
    },
  }

  if (!source.trim()) {
    state.signals.add('empty-snippet')
    state.confidencePenalty += 0.35
  }

  if (parsed.hasError) {
    state.signals.add('parser-error')
    state.confidencePenalty += 0.3
  }

  walk(parsed.root, state)

  const time = rankTime(state)
  const space = rankSpace(state)
  const asyncInfo = buildAsyncInfo(state)
  const confidence = clampConfidence(0.9 - state.confidencePenalty - (parsed.hasError ? 0.05 : 0))

  return {
    version: ESTIMATOR_VERSION,
    time: { ...time, confidence },
    space: { ...space, confidence: clampConfidence(confidence - (state.spaceRank === 0 ? 0.02 : 0)) },
    async: asyncInfo,
    explanation: explain({ time, space, state, setupContext, parsed }),
    signals: [...state.signals].slice(0, 12),
    setupContext,
  }
}

function parseSnippet(source) {
  const tree = getParser().parse(source)
  if (!tree.rootNode.hasError) return { root: tree.rootNode, hasError: false, wrapped: false }

  const wrapped = getParser().parse(`async function __jsperfSnippet__() {\n${source}\n}`)
  const fn = firstNamedChildOfType(wrapped.rootNode, [
    'function_declaration',
    'generator_function_declaration',
  ])
  const body = fn?.childForFieldName('body') || wrapped.rootNode
  return {
    root: body,
    hasError: Boolean(wrapped.rootNode.hasError),
    wrapped: true,
  }
}

function collectSetupContext(setup) {
  if (!setup.trim()) return { symbols: [], notes: ['setup parsed as context only'] }
  const tree = getParser().parse(setup)
  const symbols = new Set()
  const notes = ['setup parsed as context only']

  const visit = (node) => {
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name') || node.namedChild(0)
      if (name?.text) symbols.add(name.text)
      const value = node.childForFieldName('value')
      if (value && ['array', 'object', 'new_expression'].includes(value.type)) {
        notes.push(`${name?.text || 'setup value'} prepares reusable data`)
      }
    } else if (node.type === 'function_declaration' || node.type === 'generator_function_declaration' || node.type === 'class_declaration') {
      const name = node.childForFieldName('name') || node.namedChild(0)
      if (name?.text) symbols.add(name.text)
    }
    for (const child of namedChildren(node)) visit(child)
  }

  visit(tree.rootNode)
  if (tree.rootNode.hasError) notes.push('setup contains syntax the parser could not fully classify')
  return {
    symbols: [...symbols].slice(0, 12),
    notes: [...new Set(notes)].slice(0, 6),
  }
}

function walk(node, state) {
  if (!node) return

  if (node.type === 'await_expression') {
    state.async.hasAwait = true
    state.signals.add('await')
    if (state.loopDepth > 0) {
      state.async.awaitInLoop = true
      state.signals.add('sequential-await-in-loop')
      state.async.notes.add('await appears inside a loop, so elapsed time may add each awaited operation')
    }
  }

  if (LOOP_TYPES.has(node.type)) {
    handleLoop(node, state)
    return
  }

  if (node.type === 'call_expression') handleCall(node, state)
  if (node.type === 'new_expression') handleNew(node, state)
  if (node.type === 'spread_element') handleSpread(node, state)
  if (node.type === 'array') handleArray(node, state)
  if (node.type === 'object') handleObject(node, state)
  if (node.type === 'yield_expression' && node.text.includes('yield*')) {
    state.signals.add('yield-delegation')
    state.timeRank = Math.max(state.timeRank, 2)
    state.async.notes.add('yield* delegates traversal to another iterable when consumed')
  }

  const functionName = functionNameFor(node)
  if (functionName) state.functionStack.push(functionName)
  for (const child of namedChildren(node)) walk(child, state)
  if (functionName) state.functionStack.pop()
}

function handleLoop(node, state) {
  const isAsync = node.text.startsWith('for await')
  if (isAsync) {
    state.async.hasAsyncIteration = true
    state.signals.add('async-iteration')
    state.async.notes.add('for await...of consumes async input sequentially')
  }

  if (isFixedLoop(node)) {
    state.signals.add('fixed-count-loop')
    for (const child of namedChildren(node)) walk(child, state)
    return
  }

  state.signals.add(isAsync ? 'for-await-loop' : `${node.type.replace(/_statement$/, '')}`)
  const nextDepth = state.loopDepth + 1
  state.timeRank = Math.max(state.timeRank, rankForDepth(nextDepth))
  const previousDepth = state.loopDepth
  state.loopDepth = nextDepth
  for (const child of namedChildren(node)) walk(child, state)
  state.loopDepth = previousDepth
}

function handleCall(node, state) {
  const info = callInfo(node)
  if (!info.name) return

  if (state.functionStack.includes(info.name)) {
    state.signals.add('recursive-call')
    state.confidencePenalty += 0.25
    state.explanations.push('recursive structure detected; precise recurrence is heuristic')
    state.timeRank = Math.max(state.timeRank, 2)
  }

  if (SORT_METHODS.has(info.name)) {
    state.signals.add(info.name === 'toSorted' ? 'copying-sort' : 'sort')
    state.timeRank = Math.max(state.timeRank, 3)
    if (info.name === 'toSorted') state.spaceRank = Math.max(state.spaceRank, 1)
  }

  if (LINEAR_METHODS.has(info.name) || info.name === 'slice' || info.name === 'concat') {
    state.signals.add(`${info.name}-traversal`)
    state.timeRank = Math.max(state.timeRank, rankForDepth(state.loopDepth + 1))
  }

  if (COPYING_METHODS.has(info.name)) {
    state.signals.add(`${info.name}-allocation`)
    state.spaceRank = Math.max(state.spaceRank, 1)
  }

  if (info.object === 'Object' && OBJECT_LINEAR_METHODS.has(info.name)) {
    state.signals.add(`Object.${info.name}`)
    state.timeRank = Math.max(state.timeRank, 2)
    state.spaceRank = Math.max(state.spaceRank, 1)
  }

  if (info.object === 'Array' && (info.name === 'from' || info.name === 'of')) {
    state.signals.add(`Array.${info.name}`)
    if (info.name === 'from') {
      state.timeRank = Math.max(state.timeRank, 2)
      state.spaceRank = Math.max(state.spaceRank, 1)
    }
  }

  if (info.object === 'Array' && info.name === 'fromAsync') {
    state.signals.add('Array.fromAsync')
    state.timeRank = Math.max(state.timeRank, 2)
    state.spaceRank = Math.max(state.spaceRank, 1)
    state.async.hasArrayFromAsync = true
    state.async.notes.add('Array.fromAsync materializes input and awaits mapping sequentially')
  }

  if (info.object === 'Promise' && PROMISE_FANOUT_METHODS.has(info.name)) {
    state.signals.add(`Promise.${info.name}`)
    state.timeRank = Math.max(state.timeRank, 2)
    state.spaceRank = Math.max(state.spaceRank, 1)
    state.async.hasFanout = true
    state.async.notes.add(`Promise.${info.name} schedules a collection of async work and stores promises/results`)
  }

  if (info.object === 'Promise' && PROMISE_RACE_METHODS.has(info.name)) {
    state.signals.add(`Promise.${info.name}`)
    state.timeRank = Math.max(state.timeRank, 2)
    state.spaceRank = Math.max(state.spaceRank, 1)
    state.async.hasRace = true
    state.async.notes.add(`Promise.${info.name} can settle early, but creating the contenders still scales with input size`)
  }

  if (info.name === 'structuredClone' || info.object === 'JSON' && (info.name === 'parse' || info.name === 'stringify')) {
    state.signals.add(info.object ? `${info.object}.${info.name}` : info.name)
    state.timeRank = Math.max(state.timeRank, 2)
    state.spaceRank = Math.max(state.spaceRank, 1)
  }

  if (isRegexCall(info)) {
    state.signals.add('regex-pattern-dependent')
    state.confidencePenalty += 0.12
    state.async.notes.add('regular-expression cost depends on the pattern and input')
  }

  const callback = callbackArgument(node)
  if (callback && (LINEAR_METHODS.has(info.name) || SORT_METHODS.has(info.name))) {
    const previousDepth = state.loopDepth
    state.loopDepth = Math.max(state.loopDepth, previousDepth + (SORT_METHODS.has(info.name) ? 0 : 1))
    walk(callback, state)
    state.loopDepth = previousDepth
  }
}

function handleNew(node, state) {
  const ctor = node.namedChild(0)?.text || ''
  if (['Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'].includes(ctor)) {
    const args = node.childForFieldName('arguments') || node.namedChild(1)
    if (args?.namedChildCount > 0) {
      state.signals.add(`new-${ctor}`)
      state.timeRank = Math.max(state.timeRank, 2)
      state.spaceRank = Math.max(state.spaceRank, 1)
    }
  }
  if (ctor === 'RegExp') {
    state.signals.add('dynamic-regexp')
    state.confidencePenalty += 0.18
  }
}

function handleSpread(node, state) {
  state.signals.add('spread-copy')
  state.timeRank = Math.max(state.timeRank, 2)
  state.spaceRank = Math.max(state.spaceRank, 1)
}

function handleArray(node, state) {
  if (node.namedChildren?.some(child => child.type === 'spread_element')) {
    state.spaceRank = Math.max(state.spaceRank, 1)
  }
}

function handleObject(node, state) {
  if (node.namedChildren?.some(child => child.type === 'spread_element')) {
    state.spaceRank = Math.max(state.spaceRank, 1)
  }
}

function rankForDepth(depth) {
  if (depth <= 0) return 0
  if (depth === 1) return 2
  if (depth === 2) return 4
  return Math.min(5, depth + 2)
}

function rankTime(state) {
  if (state.signals.has('parser-error') && state.signals.size <= 2) {
    return { notation: 'unknown', label: 'unknown' }
  }
  return TIME_RANKS[Math.min(state.timeRank, TIME_RANKS.length - 1)] || TIME_RANKS[0]
}

function rankSpace(state) {
  return SPACE_RANKS[Math.min(state.spaceRank, SPACE_RANKS.length - 1)] || SPACE_RANKS[0]
}

function buildAsyncInfo(state) {
  let mode = 'none'
  let concurrency = 'sync'
  if (state.async.hasFanout) {
    mode = 'parallel-fanout'
    concurrency = 'concurrent'
  } else if (state.async.hasRace) {
    mode = 'race'
    concurrency = 'concurrent'
  } else if (state.async.hasArrayFromAsync || state.async.hasAsyncIteration) {
    mode = 'async-iteration'
    concurrency = 'sequential'
  } else if (state.async.awaitInLoop) {
    mode = 'sequential-await'
    concurrency = 'sequential'
  } else if (state.async.hasAwait) {
    mode = 'single-await'
    concurrency = 'external'
  }
  return {
    mode,
    concurrency,
    notes: [...state.async.notes].slice(0, 4),
  }
}

function explain({ time, space, state, setupContext, parsed }) {
  if (time.label === 'unknown') {
    return 'The snippet could not be parsed reliably enough for a Big-O estimate.'
  }

  const parts = []
  if (state.signals.has('sort') || state.signals.has('copying-sort')) {
    parts.push('A sort operation dominates the time estimate.')
  } else if (time.label === 'quadratic' || time.label === 'cubic') {
    parts.push('Nested dynamic traversals dominate the time estimate.')
  } else if (time.label === 'linear') {
    parts.push('A dynamic loop, iterable traversal, or collection helper drives a linear time estimate.')
  } else {
    parts.push('Only straight-line work or fixed-size operations were detected.')
  }

  if (space.label === 'linear') {
    parts.push('The snippet appears to allocate or copy data proportional to the input.')
  } else {
    parts.push('No input-sized allocation was detected, so auxiliary space is estimated as constant.')
  }

  if (state.async.hasFanout) {
    parts.push('Promise fan-out changes scheduling: total work still scales with the collection, while wall-clock time depends on the slowest task and resource pressure.')
  } else if (state.async.awaitInLoop || state.async.hasAsyncIteration || state.async.hasArrayFromAsync) {
    parts.push('Async work is consumed sequentially, so awaited latency may accumulate across items.')
  } else if (state.async.hasAwait) {
    parts.push('The await boundary adds external latency but does not by itself change CPU complexity.')
  }

  if (setupContext.symbols.length > 0) {
    parts.push(`Setup symbols used as context: ${setupContext.symbols.slice(0, 4).join(', ')}.`)
  }

  if (parsed.hasError) {
    parts.push('Parser recovery was required, so confidence is reduced.')
  }

  return parts.join(' ')
}

function clampConfidence(value) {
  return Math.max(0.15, Math.min(0.98, Number(value.toFixed(2))))
}

function callInfo(node) {
  const fn = node.childForFieldName('function') || node.namedChild(0)
  if (!fn) return { name: null, object: null }
  if (fn.type === 'identifier') return { name: fn.text, object: null }
  if (fn.type === 'member_expression') {
    const property = fn.childForFieldName('property')
    const object = fn.childForFieldName('object')
    return {
      name: property?.text || null,
      object: object?.text || null,
    }
  }
  return { name: fn.text, object: null }
}

function callbackArgument(node) {
  const args = node.childForFieldName('arguments')
  if (!args) return null
  for (const child of namedChildren(args)) {
    if (child.type === 'arrow_function' || child.type === 'function' || child.type === 'function_declaration') {
      return child
    }
  }
  return null
}

function isRegexCall(info) {
  return info.object === 'RegExp' ||
    info.name === 'match' ||
    info.name === 'matchAll' ||
    info.name === 'replace' ||
    info.name === 'replaceAll' ||
    info.name === 'search' ||
    info.name === 'test'
}

function isFixedLoop(node) {
  const text = node.text.replace(/\s+/g, ' ')
  return /^for\s*\([^;]*;[^;]*(?:<|<=|>|>=)\s*\d+\s*;/.test(text) ||
    /^for\s*\([^;]*;[^;]*\d+\s*(?:<|<=|>|>=)/.test(text)
}

function functionNameFor(node) {
  if (![
    'function_declaration',
    'generator_function_declaration',
    'function',
    'method_definition',
  ].includes(node.type)) return null
  const name = node.childForFieldName('name') || node.namedChild(0)
  return name?.type === 'identifier' || name?.type === 'property_identifier' ? name.text : null
}

function firstNamedChildOfType(node, types) {
  if (!node) return null
  if (types.includes(node.type)) return node
  for (const child of namedChildren(node)) {
    const found = firstNamedChildOfType(child, types)
    if (found) return found
  }
  return null
}

function namedChildren(node) {
  const children = []
  for (let i = 0; i < node.namedChildCount; i++) {
    children.push(node.namedChild(i))
  }
  return children
}
