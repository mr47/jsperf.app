import { parse } from '@babel/parser'

export type AstMatch = {
  type: string
  label: string
  start: number
  end: number
  snippet: string
}

export type JitInstructionLine = {
  text: string
  address: string | null
  pcOffset: number | null
  pcOffsetHex: string | null
}

export type JitSourcePositionEntry = {
  pcOffset: number
  pcOffsetHex: string
  sourcePosition: number
  mappedSourcePosition: number | null
}

export type JitSourceMapRange = {
  id: string
  pcOffset: number
  pcOffsetHex: string
  endPcOffset: number | null
  endPcOffsetHex: string | null
  pcRanges: Array<{
    start: number
    startHex: string
    end: number | null
    endHex: string | null
  }>
  sourcePosition: number
  mappedSourcePosition: number
  sourceStart: number
  sourceEnd: number
  sourceSnippet: string
  instructions: string
  instructionCount: number
  astMatch: AstMatch | null
}

export type OptimizedBlock = {
  id: string
  index: number
  source: string
  rawSource: string
  optimized: string
  optimizedBody: string
  instructionBody: string
  optimizationId: string | null
  sourcePosition: string | null
  mappedSourcePosition: number | null
  functionSourceStart: number | null
  kind: string | null
  name: string | null
  compiler: string | null
  instructionSize: string | null
  instructions: JitInstructionLine[]
  sourcePositions: JitSourcePositionEntry[]
  mappedRanges: JitSourceMapRange[]
  hasPreciseSourceMap: boolean
  astMatch: AstMatch | null
}

type AstNode = {
  type?: string
  start?: number
  end?: number
  id?: { name?: string }
  key?: { name?: string; value?: unknown }
  property?: { name?: string; value?: unknown }
  callee?: { name?: string; property?: { name?: string } }
  operator?: string
  kind?: string
  declarations?: Array<{ id?: { name?: string } }>
  [key: string]: unknown
}

const FUNCTION_SOURCE_RE = /^--- FUNCTION SOURCE [^\n]*\bstart\{(\d+)\} [^\n]*---$/gm
const WRAPPER_PREFIX_RE = /^(?:async\s+)?(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*)?\([^)]*\)\s*\{\s*\n?/
const WRAPPER_SUFFIX_RE = /\n?\s*\}\)?\s*$/
const INSTRUCTION_LINE_RE = /^\s*(0x[0-9a-f]+)\s+([0-9a-f]+)\s+(.+)$/i
const TOKEN_SIZED_NODE_TYPES = new Set([
  'Identifier',
  'NumericLiteral',
  'StringLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'ThisExpression',
])
const HIGHLIGHT_NODE_TYPES = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'BinaryExpression',
  'CallExpression',
  'ConditionalExpression',
  'ExpressionStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'Identifier',
  'IfStatement',
  'LogicalExpression',
  'MemberExpression',
  'NewExpression',
  'ObjectExpression',
  'ReturnStatement',
  'SpreadElement',
  'TemplateLiteral',
  'UnaryExpression',
  'UpdateExpression',
  'VariableDeclaration',
])

export function parseOptimizedBlocks(output: string): OptimizedBlock[] {
  if (!output) return []
  const rawMarker = '--- Raw source ---'
  const optimizedMarker = '--- Optimized code ---'
  const blocks: OptimizedBlock[] = []
  let cursor = 0

  while (cursor < output.length) {
    const rawStart = output.indexOf(rawMarker, cursor)
    if (rawStart === -1) break
    const optimizedStart = output.indexOf(optimizedMarker, rawStart + rawMarker.length)
    if (optimizedStart === -1) break

    const nextRawStart = output.indexOf(rawMarker, optimizedStart + optimizedMarker.length)
    const rawSource = output.slice(rawStart + rawMarker.length, optimizedStart).trim()
    const functionSourceStart = findFunctionSourceStartBefore(output, rawStart)
    const sourceInfo = cleanRawSource(rawSource, functionSourceStart)
    const optimized = output
      .slice(
        optimizedStart + optimizedMarker.length,
        nextRawStart === -1 ? output.length : nextRawStart,
      )
      .trim()

    if (sourceInfo.source && optimized) {
      const index = blocks.length
      const sourcePosition = findMetadata(optimized, 'source_position')
      const mappedSourcePosition = mapSourcePositionToCleanSource(sourcePosition, sourceInfo)
      const instructions = parseInstructionLines(optimized)
      const sourcePositions = parseSourcePositions(optimized, sourceInfo)
      const mappedRanges = buildMappedRanges({
        blockId: `optimized-block-${index}`,
        source: sourceInfo.source,
        instructions,
        sourcePositions,
      })
      blocks.push({
        id: `optimized-block-${index}`,
        index,
        source: sourceInfo.source,
        rawSource,
        optimized,
        optimizedBody: stripOptimizedMetadata(optimized),
        instructionBody: extractInstructionBody(optimized),
        optimizationId: findMetadata(optimized, 'optimization_id'),
        sourcePosition,
        mappedSourcePosition,
        functionSourceStart,
        kind: findMetadata(optimized, 'kind'),
        name: findMetadata(optimized, 'name'),
        compiler: findMetadata(optimized, 'compiler'),
        instructionSize: findInstructionSize(optimized),
        instructions,
        sourcePositions,
        mappedRanges,
        hasPreciseSourceMap: mappedRanges.length > 0,
        astMatch: mappedSourcePosition == null
          ? findRepresentativeAstNode(sourceInfo.source)
          : findAstNodeAt(sourceInfo.source, mappedSourcePosition),
      })
    }

    cursor = nextRawStart === -1 ? output.length : nextRawStart
  }

  return blocks
}

function cleanRawSource(rawSource: string, functionSourceStart: number | null = null) {
  const prefix = rawSource.match(WRAPPER_PREFIX_RE)?.[0] || ''
  const withoutPrefix = prefix ? rawSource.slice(prefix.length) : rawSource
  const suffixMatch = withoutPrefix.match(WRAPPER_SUFFIX_RE)
  const source = (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).trim()
  const leadingTrim = (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).length - (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).trimStart().length

  return {
    source: source || rawSource.trim(),
    prefixLength: prefix.length + leadingTrim,
    absoluteBaseOffset: functionSourceStart == null ? null : functionSourceStart + prefix.length + leadingTrim,
  }
}

function mapSourcePositionToCleanSource(
  sourcePosition: string | number | null,
  sourceInfo: { source: string; prefixLength: number; absoluteBaseOffset?: number | null },
) {
  const absolute = Number(sourcePosition)
  if (!Number.isFinite(absolute)) return null
  const mapped = absolute - (sourceInfo.absoluteBaseOffset ?? sourceInfo.prefixLength)
  if (mapped < 0) return 0
  if (mapped > sourceInfo.source.length) return sourceInfo.source.length
  return mapped
}

function findAstNodeAt(source: string, position: number): AstMatch | null {
  return findAstNodeAtWithOptions(source, position, { allowTokenSized: true })
}

function findSourceExtentAt(source: string, position: number): AstMatch | null {
  return findAstNodeAtWithOptions(source, position, { allowTokenSized: false })
}

function findAstNodeAtWithOptions(source: string, position: number, options: { allowTokenSized: boolean }): AstMatch | null {
  const ast = parseSource(source)
  if (!ast) return findRepresentativeAstNode(source)

  const candidates: AstNode[] = []
  visitAst(ast as unknown as AstNode, (node) => {
    if (!isInterestingNode(node)) return
    if (!options.allowTokenSized && isTokenSizedNode(node)) return
    if (typeof node.start !== 'number' || typeof node.end !== 'number') return
    if (node.start <= position && position <= node.end) candidates.push(node)
  })

  const best = candidates
    .sort((a, b) => {
      if (options.allowTokenSized) return ((a.end! - a.start!) - (b.end! - b.start!))
      return scoreSourceExtent(a, position) - scoreSourceExtent(b, position)
    })[0]

  return best ? toAstMatch(best, source) : findRepresentativeAstNode(source)
}

function findRepresentativeAstNode(source: string): AstMatch | null {
  const ast = parseSource(source)
  if (!ast) return null

  const candidates: AstNode[] = []
  visitAst(ast as unknown as AstNode, (node) => {
    if (isInterestingNode(node) && typeof node.start === 'number' && typeof node.end === 'number') {
      candidates.push(node)
    }
  })

  const best = candidates.find(node => node.type !== 'Identifier') || candidates[0]
  return best ? toAstMatch(best, source) : null
}

function parseSource(source: string) {
  const plugins: any[] = [
    'asyncGenerators',
    'classProperties',
    'classPrivateMethods',
    'classPrivateProperties',
    'dynamicImport',
    'importMeta',
    'jsx',
    'logicalAssignment',
    'nullishCoalescingOperator',
    'objectRestSpread',
    'optionalChaining',
    'topLevelAwait',
  ]

  for (const wrapped of [source, `function __jitSnippet__(){\n${source}\n}`]) {
    try {
      return parse(wrapped, {
        sourceType: 'script',
        errorRecovery: true,
        plugins,
      })
    } catch (_) {
      // Try the function-body wrapper for snippets such as `return value`.
    }
  }
  return null
}

function visitAst(node: AstNode | null | undefined, visit: (node: AstNode) => void) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'loc' ||
      key === 'start' ||
      key === 'end' ||
      key === 'leadingComments' ||
      key === 'trailingComments' ||
      key === 'innerComments'
    ) continue

    if (Array.isArray(value)) {
      for (const item of value) visitAst(item as AstNode, visit)
    } else if (value && typeof value === 'object') {
      visitAst(value as AstNode, visit)
    }
  }
}

function isInterestingNode(node: AstNode) {
  return Boolean(node.type && HIGHLIGHT_NODE_TYPES.has(node.type))
}

function isTokenSizedNode(node: AstNode) {
  return Boolean(node.type && TOKEN_SIZED_NODE_TYPES.has(node.type))
}

function scoreSourceExtent(node: AstNode, position: number) {
  const size = Math.max(0, (node.end || 0) - (node.start || 0))
  const type = String(node.type || '')
  if (type === 'ExpressionStatement') return size - 1000
  if (type === 'VariableDeclaration' || type === 'ReturnStatement') return size - 950
  if (type === 'ForStatement' || type === 'ForOfStatement' || type === 'IfStatement') return size - 900
  if (type === 'CallExpression') return size - 200
  if (type === 'ArrayExpression' || type === 'ObjectExpression') return size - 150
  if ((node.start || 0) === position && size <= 2) return size + 1000
  return size + 100
}

function toAstMatch(node: AstNode, source: string): AstMatch {
  const start = Math.max(0, Number(node.start) || 0)
  const end = Math.max(start, Number(node.end) || start)
  return {
    type: node.type || 'Node',
    label: describeAstNode(node),
    start,
    end,
    snippet: source.slice(start, end).trim(),
  }
}

function describeAstNode(node: AstNode) {
  switch (node.type) {
    case 'VariableDeclaration':
      return `${node.kind || 'var'} ${node.declarations?.map(decl => decl?.id?.name).filter(Boolean).join(', ') || 'declaration'}`
    case 'CallExpression':
      return `call ${calleeName(node) || 'expression'}`
    case 'MemberExpression':
      return `member ${memberName(node) || 'access'}`
    case 'BinaryExpression':
    case 'LogicalExpression':
      return `${node.type.replace('Expression', '').toLowerCase()} ${node.operator || ''}`.trim()
    case 'SpreadElement':
      return 'spread element'
    case 'ArrayExpression':
      return 'array literal'
    case 'ObjectExpression':
      return 'object literal'
    case 'ExpressionStatement':
      return 'expression statement'
    case 'ReturnStatement':
      return 'return statement'
    case 'ForStatement':
    case 'ForOfStatement':
      return 'loop'
    case 'IfStatement':
      return 'conditional'
    case 'Identifier':
      return `identifier ${(node as any).name || ''}`.trim()
    default:
      return String(node.type || 'AST node')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
  }
}

function calleeName(node: AstNode) {
  if (node.callee?.name) return node.callee.name
  if (node.callee?.property?.name) return node.callee.property.name
  return null
}

function memberName(node: AstNode) {
  const property = node.property
  if (!property) return null
  if (property.name) return property.name
  if (property.value != null) return String(property.value)
  return null
}

function findFunctionSourceStartBefore(output: string, rawStart: number) {
  let match: RegExpExecArray | null
  let start: number | null = null
  FUNCTION_SOURCE_RE.lastIndex = 0
  while ((match = FUNCTION_SOURCE_RE.exec(output))) {
    if (match.index > rawStart) break
    const parsed = Number(match[1])
    if (Number.isFinite(parsed)) start = parsed
  }
  return start
}

function findMetadata(block: string, key: string) {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))
  return match?.[1]?.trim() || null
}

function findInstructionSize(block: string) {
  const match = block.match(/^Instructions\s+\(size\s*=\s*(\d+)\)/m)
  return match?.[1]?.trim() || null
}

function stripOptimizedMetadata(block: string) {
  const instructionsIndex = block.search(/^Instructions\s+\(size\s*=\s*\d+\)/m)
  if (instructionsIndex === -1) return block
  return block.slice(instructionsIndex).trim()
}

function extractInstructionBody(block: string) {
  const instructionsIndex = block.search(/^Instructions\s+\(size\s*=\s*\d+\)/m)
  if (instructionsIndex === -1) return ''
  const rest = block.slice(instructionsIndex)
  const endMatch = rest.search(/^\s*(Source positions:|Safepoints\s+\(|RelocInfo\s+\(|Deoptimization Input Data|Inlined functions\s+\()/m)
  return (endMatch === -1 ? rest : rest.slice(0, endMatch)).trim()
}

function parseInstructionLines(block: string): JitInstructionLine[] {
  const body = extractInstructionBody(block)
  if (!body) return []

  return body
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(INSTRUCTION_LINE_RE)
      if (!match) {
        return {
          text: line,
          address: null,
          pcOffset: null,
          pcOffsetHex: null,
        }
      }
      const pcOffset = parseInt(match[2], 16)
      return {
        text: line,
        address: match[1],
        pcOffset: Number.isFinite(pcOffset) ? pcOffset : null,
        pcOffsetHex: match[2].toLowerCase(),
      }
    })
}

function parseSourcePositions(
  block: string,
  sourceInfo: { source: string; prefixLength: number; absoluteBaseOffset?: number | null },
): JitSourcePositionEntry[] {
  const lines = block.split(/\r?\n/)
  const startIndex = lines.findIndex(line => line.trim() === 'Source positions:')
  if (startIndex === -1) return []

  const entries: JitSourcePositionEntry[] = []
  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed || /^pc offset\s+position$/i.test(trimmed)) continue

    const match = trimmed.match(/^([0-9a-f]+)\s+(-?\d+)$/i)
    if (!match) {
      if (entries.length > 0) break
      continue
    }

    const pcOffset = parseInt(match[1], 16)
    const sourcePosition = Number(match[2])
    if (!Number.isFinite(pcOffset) || !Number.isFinite(sourcePosition) || sourcePosition < 0) continue

    entries.push({
      pcOffset,
      pcOffsetHex: match[1].toLowerCase(),
      sourcePosition,
      mappedSourcePosition: mapSourcePositionToCleanSource(sourcePosition, sourceInfo),
    })
  }

  return entries
}

function buildMappedRanges({
  blockId,
  source,
  instructions,
  sourcePositions,
}: {
  blockId: string
  source: string
  instructions: JitInstructionLine[]
  sourcePositions: JitSourcePositionEntry[]
}): JitSourceMapRange[] {
  const instructionRows = instructions.filter((line): line is JitInstructionLine & { pcOffset: number } =>
    typeof line.pcOffset === 'number'
  )
  if (instructionRows.length === 0 || sourcePositions.length === 0) return []

  const ranges = sourcePositions
    .filter((entry): entry is JitSourcePositionEntry & { mappedSourcePosition: number } =>
      typeof entry.mappedSourcePosition === 'number'
    )
    .map((entry, index, entries) => {
      const next = entries[index + 1] || null
      const rangeInstructions = instructionRows.filter(line =>
        line.pcOffset >= entry.pcOffset && (next ? line.pcOffset < next.pcOffset : true)
      )
      if (rangeInstructions.length === 0) return null

      const astMatch = findSourceExtentAt(source, entry.mappedSourcePosition)
      const sourceStart = astMatch?.start ?? entry.mappedSourcePosition
      const sourceEnd = Math.max(astMatch?.end ?? entry.mappedSourcePosition + 1, sourceStart + 1)
      const sourceSnippet = (astMatch?.snippet || source.slice(sourceStart, sourceEnd)).trim()

      return {
        id: `${blockId}-range-${index}`,
        pcOffset: entry.pcOffset,
        pcOffsetHex: entry.pcOffsetHex,
        endPcOffset: next?.pcOffset ?? null,
        endPcOffsetHex: next?.pcOffsetHex ?? null,
        pcRanges: [{
          start: entry.pcOffset,
          startHex: entry.pcOffsetHex,
          end: next?.pcOffset ?? null,
          endHex: next?.pcOffsetHex ?? null,
        }],
        sourcePosition: entry.sourcePosition,
        mappedSourcePosition: entry.mappedSourcePosition,
        sourceStart,
        sourceEnd: Math.min(source.length, sourceEnd),
        sourceSnippet,
        instructions: rangeInstructions.map(line => line.text).join('\n'),
        instructionCount: rangeInstructions.length,
        astMatch,
      }
    })
    .filter((range): range is JitSourceMapRange => Boolean(range))

  return mergeRangesForSameSourceSpan(ranges, blockId)
}

function mergeRangesForSameSourceSpan(ranges: JitSourceMapRange[], blockId: string) {
  const bySourceSpan = new Map<string, JitSourceMapRange>()

  for (const range of ranges) {
    const key = `${range.sourceStart}:${range.sourceEnd}`
    const existing = bySourceSpan.get(key)

    if (!existing) {
      bySourceSpan.set(key, {
        ...range,
        pcRanges: [...range.pcRanges],
      })
      continue
    }

    existing.pcOffset = Math.min(existing.pcOffset, range.pcOffset)
    existing.pcOffsetHex = existing.pcOffset.toString(16)
    existing.sourcePosition = Math.min(existing.sourcePosition, range.sourcePosition)
    existing.mappedSourcePosition = Math.min(existing.mappedSourcePosition, range.mappedSourcePosition)
    existing.endPcOffset = range.endPcOffset ?? existing.endPcOffset
    existing.endPcOffsetHex = range.endPcOffsetHex ?? existing.endPcOffsetHex
    existing.pcRanges.push(...range.pcRanges)
    existing.instructions = `${existing.instructions}\n${range.instructions}`
    existing.instructionCount += range.instructionCount
  }

  return Array.from(bySourceSpan.values())
    .sort((a, b) => a.sourceStart - b.sourceStart || a.pcOffset - b.pcOffset)
    .map((range, index) => ({
      ...range,
      id: `${blockId}-span-${index}`,
      pcRanges: range.pcRanges.sort((a, b) => a.start - b.start),
    }))
}
