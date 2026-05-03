import { parse } from '@babel/parser'

export type AstMatch = {
  type: string
  label: string
  start: number
  end: number
  snippet: string
}

export type OptimizedBlock = {
  id: string
  index: number
  source: string
  rawSource: string
  optimized: string
  optimizedBody: string
  optimizationId: string | null
  sourcePosition: string | null
  mappedSourcePosition: number | null
  kind: string | null
  name: string | null
  compiler: string | null
  instructionSize: string | null
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

const WRAPPER_PREFIX_RE = /^\(\)\s*{\s*\n?/
const WRAPPER_SUFFIX_RE = /\n?\s*\}\)$/m
const HIGHLIGHT_NODE_TYPES = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'BinaryExpression',
  'CallExpression',
  'ConditionalExpression',
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
    const sourceInfo = cleanRawSource(rawSource)
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
      blocks.push({
        id: `optimized-block-${index}`,
        index,
        source: sourceInfo.source,
        rawSource,
        optimized,
        optimizedBody: stripOptimizedMetadata(optimized),
        optimizationId: findMetadata(optimized, 'optimization_id'),
        sourcePosition,
        mappedSourcePosition,
        kind: findMetadata(optimized, 'kind'),
        name: findMetadata(optimized, 'name'),
        compiler: findMetadata(optimized, 'compiler'),
        instructionSize: findInstructionSize(optimized),
        astMatch: mappedSourcePosition == null
          ? findRepresentativeAstNode(sourceInfo.source)
          : findAstNodeAt(sourceInfo.source, mappedSourcePosition),
      })
    }

    cursor = nextRawStart === -1 ? output.length : nextRawStart + rawMarker.length
  }

  return blocks
}

function cleanRawSource(rawSource: string) {
  const prefix = rawSource.match(WRAPPER_PREFIX_RE)?.[0] || ''
  const withoutPrefix = prefix ? rawSource.slice(prefix.length) : rawSource
  const suffixMatch = withoutPrefix.match(WRAPPER_SUFFIX_RE)
  const source = (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).trim()
  const leadingTrim = (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).length - (suffixMatch ? withoutPrefix.slice(0, suffixMatch.index) : withoutPrefix).trimStart().length

  return {
    source: source || rawSource.trim(),
    prefixLength: prefix.length + leadingTrim,
  }
}

function mapSourcePositionToCleanSource(sourcePosition: string | null, sourceInfo: { source: string; prefixLength: number }) {
  const absolute = Number(sourcePosition)
  if (!Number.isFinite(absolute)) return null
  const mapped = absolute - sourceInfo.prefixLength
  if (mapped < 0) return 0
  if (mapped > sourceInfo.source.length) return sourceInfo.source.length
  return mapped
}

function findAstNodeAt(source: string, position: number): AstMatch | null {
  const ast = parseSource(source)
  if (!ast) return findRepresentativeAstNode(source)

  const candidates: AstNode[] = []
  visitAst(ast as unknown as AstNode, (node) => {
    if (!isInterestingNode(node)) return
    if (typeof node.start !== 'number' || typeof node.end !== 'number') return
    if (node.start <= position && position <= node.end) candidates.push(node)
  })

  const best = candidates
    .sort((a, b) => ((a.end! - a.start!) - (b.end! - b.start!)))[0]

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
