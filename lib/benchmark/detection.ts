import * as ts from 'typescript'
import type { BenchmarkTestSource } from './types'

const PROMISE_STATIC_METHODS = new Set(['resolve', 'reject', 'all', 'allSettled', 'race', 'any'])
const PROMISE_CHAIN_METHODS = new Set(['then', 'catch', 'finally'])
const TIMER_ASYNC_FUNCTIONS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask'])
const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'copyWithin',
  'fill',
  'set',
  'add',
  'delete',
  'clear',
  'append',
  'appendChild',
  'remove',
  'removeChild',
])

const DECLARED_SETUP_CONSTRUCTORS = new Set(['Array', 'Map', 'Set', 'WeakMap', 'WeakSet'])
const SETUP_CONSTRUCTORS = new Set([
  ...DECLARED_SETUP_CONSTRUCTORS,
  'Date',
  'RegExp',
  'URL',
  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
])
const SETUP_STATIC_CALLS = new Set(['Array.from', 'JSON.parse', 'structuredClone'])
const DECLARED_SETUP_STATIC_CALLS = SETUP_STATIC_CALLS
const LARGE_ARRAY_LITERAL_LENGTH = 180
const LARGE_OBJECT_LITERAL_LENGTH = 240

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

const BROWSER_API_GLOBAL_SET = new Set(BROWSER_API_GLOBALS)
const GLOBAL_OBJECTS = new Set(['globalThis', 'self'])
const MATH_METHODS = new Set([
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

const FOLDABLE_IDENTIFIERS = new Set(['undefined', 'NaN', 'Infinity'])
const FOLDABLE_BINARY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
])

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
])

export function isAsyncTest(test?: BenchmarkTestSource | null): boolean {
  if (test?.async === true) return true
  return testSourceParts(test).some(source => hasAsyncMarker(parseSource(source)))
}

export interface BenchmarkSourceRisk {
  evidence: string
}

export function findAsyncNotAwaitedRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  if (isAsyncTest(test)) return null

  const source = primaryTestSource(test)
  if (!source) return null

  const node = findFirstNode(parseSource(source), isRiskyAsyncWork)
  return node ? { evidence: nodeSnippet(node) } : null
}

export function findDeadCodeEliminationRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const sourceFile = parseSource(source)
  if (!findFirstNode(sourceFile, isComputableWork)) return null
  if (findFirstNode(sourceFile, isObservableEffect)) return null

  return {
    evidence: firstMeaningfulSnippet(sourceFile) || 'Snippet appears to compute a value without making it observable',
  }
}

export function findConstantFoldingRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const node = findConstantFoldingNode(parseSource(source))
  return node ? { evidence: nodeSnippet(node) } : null
}

export function findSetupInMeasuredCodeRisk(test?: BenchmarkTestSource | null): BenchmarkSourceRisk | null {
  const source = primaryTestSource(test)
  if (!source) return null

  const sourceFile = parseSource(source)
  const declaredSetup = findFirstNode(sourceFile, isDeclaredSetupWork)
  const setupWork = findFirstNode(sourceFile, isSetupWork)
  const largeLiteral = findFirstNode(sourceFile, isLargeLiteral)
  const node = declaredSetup || setupWork || largeLiteral

  if (!node) return null
  if (findFirstNode(sourceFile, ts.isReturnStatement) && !declaredSetup && !largeLiteral) {
    return null
  }

  return { evidence: nodeSnippet(node) }
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

  const matches = new Set<string>()
  const sourceFile = parseSource(source)

  collectBrowserApiGlobals(sourceFile, [new Set()], matches)

  return [...matches].sort()
}

function collectBrowserApiGlobals(node: ts.Node, scopes: Array<Set<string>>, matches: Set<string>): void {
  const currentScope = scopes[scopes.length - 1]

  if (ts.isVariableDeclaration(node)) {
    addBrowserBindingNames(node.name, currentScope)
    if (node.initializer) collectBrowserApiGlobals(node.initializer, scopes, matches)
    return
  }

  if (ts.isFunctionDeclaration(node)) {
    if (node.name) addBrowserBindingNames(node.name, currentScope)
    const functionScope = new Set<string>()
    for (const parameter of node.parameters) addBrowserBindingNames(parameter.name, functionScope)
    if (node.body) collectBrowserApiGlobals(node.body, [...scopes, functionScope], matches)
    return
  }

  if (isFunctionScopeNode(node)) {
    const functionScope = new Set<string>()
    for (const parameter of node.parameters) addBrowserBindingNames(parameter.name, functionScope)
    if (node.body) collectBrowserApiGlobals(node.body, [...scopes, functionScope], matches)
    return
  }

  if (ts.isBlock(node) || ts.isSourceFile(node)) {
    const blockScopes = ts.isSourceFile(node) ? scopes : [...scopes, new Set<string>()]
    node.forEachChild(child => collectBrowserApiGlobals(child, blockScopes, matches))
    return
  }

  if (ts.isClassDeclaration(node) && node.name) {
    addBrowserBindingNames(node.name, currentScope)
  }

  if (ts.isImportDeclaration(node)) {
    collectImportBindings(node, currentScope)
    return
  }

  if (ts.isPropertyAccessExpression(node) && isGlobalObjectExpression(node.expression)) {
    const apiName = node.name.text
    if (BROWSER_API_GLOBAL_SET.has(apiName)) matches.add(apiName)
  }

  if (ts.isIdentifier(node) && BROWSER_API_GLOBAL_SET.has(node.text) && isIdentifierReference(node) && !isShadowed(node.text, scopes)) {
    matches.add(node.text)
  }

  node.forEachChild(child => collectBrowserApiGlobals(child, scopes, matches))
}

function isFunctionScopeNode(node: ts.Node): node is ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration {
  return (
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function addBrowserBindingNames(name: ts.BindingName, scope: Set<string>): void {
  if (ts.isIdentifier(name)) {
    if (BROWSER_API_GLOBAL_SET.has(name.text)) scope.add(name.text)
    return
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) addBrowserBindingNames(element.name, scope)
  }
}

function collectImportBindings(node: ts.ImportDeclaration, scope: Set<string>): void {
  const clause = node.importClause
  if (!clause) return

  if (clause.name) addBrowserBindingNames(clause.name, scope)
  const bindings = clause.namedBindings
  if (!bindings) return

  if (ts.isNamespaceImport(bindings)) {
    addBrowserBindingNames(bindings.name, scope)
    return
  }

  for (const element of bindings.elements) addBrowserBindingNames(element.name, scope)
}

function isShadowed(name: string, scopes: Array<Set<string>>): boolean {
  return scopes.some(scope => scope.has(name))
}

function primaryTestSource(test?: BenchmarkTestSource | null): string {
  return testSourceParts(test).find(value => value.trim().length > 0) || ''
}

function testSourceParts(test?: BenchmarkTestSource | null): string[] {
  return [
    typeof test?.originalCode === 'string' ? test.originalCode : '',
    typeof test?.code === 'string' ? test.code : '',
    typeof test?.runtimeCode === 'string' ? test.runtimeCode : '',
  ].filter(Boolean)
}

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('benchmark-snippet.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function visit(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node)
  node.forEachChild(child => visit(child, visitor))
}

function findFirstNode<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T | null
function findFirstNode(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node | null
function findFirstNode(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node | null {
  let match: ts.Node | null = null
  visit(root, (node) => {
    if (!match && predicate(node)) match = node
  })
  return match
}

function hasAsyncMarker(sourceFile: ts.SourceFile): boolean {
  return Boolean(findFirstNode(sourceFile, (node) =>
    ts.isAwaitExpression(node) ||
    isAsyncFunctionLike(node) ||
    isDeferredResolveCall(node) ||
    isReturnNewPromise(node)
  ))
}

function isAsyncFunctionLike(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false
  return Boolean(ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
}

function isReturnNewPromise(node: ts.Node): boolean {
  return ts.isReturnStatement(node) && Boolean(node.expression && isNewPromiseExpression(node.expression))
}

function isNewPromiseExpression(node: ts.Node): boolean {
  return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Promise'
}

function isRiskyAsyncWork(node: ts.Node): boolean {
  return ts.isCallExpression(node) && (
    isPromiseStaticCall(node) ||
    isPromiseChainCall(node) ||
    isFetchCall(node) ||
    isTimerAsyncCall(node)
  )
}

function isPromiseStaticCall(node: ts.CallExpression): boolean {
  const expression = node.expression
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Promise' &&
    PROMISE_STATIC_METHODS.has(expression.name.text)
  )
}

function isPromiseChainCall(node: ts.CallExpression): boolean {
  const expression = node.expression
  return ts.isPropertyAccessExpression(expression) && PROMISE_CHAIN_METHODS.has(expression.name.text)
}

function isFetchCall(node: ts.CallExpression): boolean {
  return callName(node) === 'fetch'
}

function isTimerAsyncCall(node: ts.CallExpression): boolean {
  const name = callName(node)
  return Boolean(name && TIMER_ASYNC_FUNCTIONS.has(name))
}

function isComputableWork(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    (ts.isBinaryExpression(node) && !ASSIGNMENT_OPERATORS.has(node.operatorToken.kind))
  )
}

function isObservableEffect(node: ts.Node): boolean {
  return (
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    isAssignmentExpression(node) ||
    isUpdateExpression(node) ||
    isMutatingCall(node) ||
    isConsoleOrPerformanceCall(node) ||
    isDeferredResolveCall(node)
  )
}

function isAssignmentExpression(node: ts.Node): boolean {
  return ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)
}

function isUpdateExpression(node: ts.Node): boolean {
  return (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  )
}

function isMutatingCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const name = callName(node)
  return Boolean(name && MUTATING_METHODS.has(name))
}

function isConsoleOrPerformanceCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  const owner = node.expression.expression
  return ts.isIdentifier(owner) && (owner.text === 'console' || owner.text === 'performance')
}

function isDeferredResolveCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  return (
    node.expression.name.text === 'resolve' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'deferred'
  )
}

function findConstantFoldingNode(sourceFile: ts.SourceFile): ts.Expression | null {
  let match: ts.Expression | null = null
  visit(sourceFile, (node) => {
    if (match) return
    const expression = measuredExpression(node)
    if (expression && expressionContainsFoldableWork(expression) && isFoldableExpression(expression)) {
      match = expression
    }
  })
  return match
}

function measuredExpression(node: ts.Node): ts.Expression | null {
  if (ts.isReturnStatement(node)) return node.expression || null
  if (ts.isExpressionStatement(node)) return node.expression
  return null
}

function expressionContainsFoldableWork(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return expressionContainsFoldableWork(expression.expression)
  if (ts.isBinaryExpression(expression) && FOLDABLE_BINARY_OPERATORS.has(expression.operatorToken.kind)) return true
  if (ts.isCallExpression(expression) && isMathCall(expression)) return true

  let hasWork = false
  expression.forEachChild((child) => {
    if (!hasWork && ts.isExpression(child)) hasWork = expressionContainsFoldableWork(child)
  })
  return hasWork
}

function isFoldableExpression(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return isFoldableExpression(expression.expression)
  if (ts.isNumericLiteral(expression) || ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return true
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword || expression.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(expression)) return FOLDABLE_IDENTIFIERS.has(expression.text)

  if (ts.isPrefixUnaryExpression(expression)) {
    return (
      [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.ExclamationToken,
        ts.SyntaxKind.TildeToken,
      ].includes(expression.operator) &&
      isFoldableExpression(expression.operand)
    )
  }

  if (ts.isBinaryExpression(expression)) {
    return (
      FOLDABLE_BINARY_OPERATORS.has(expression.operatorToken.kind) &&
      isFoldableExpression(expression.left) &&
      isFoldableExpression(expression.right)
    )
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.every(element => ts.isExpression(element) && isFoldableExpression(element))
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every((property) => {
      if (ts.isPropertyAssignment(property)) return isFoldableExpression(property.initializer)
      if (ts.isShorthandPropertyAssignment(property)) return isFoldableExpression(property.name)
      return false
    })
  }

  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.every(span => isFoldableExpression(span.expression))
  }

  if (ts.isConditionalExpression(expression)) {
    return (
      isFoldableExpression(expression.condition) &&
      isFoldableExpression(expression.whenTrue) &&
      isFoldableExpression(expression.whenFalse)
    )
  }

  return ts.isCallExpression(expression) && isMathCall(expression) && expression.arguments.every(isFoldableExpression)
}

function isMathCall(node: ts.CallExpression): boolean {
  const expression = node.expression
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Math' &&
    MATH_METHODS.has(expression.name.text)
  )
}

function isDeclaredSetupWork(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node) || !node.initializer) return false
  return isDeclaredSetupInitializer(node.initializer) || isLargeLiteral(node.initializer)
}

function isDeclaredSetupInitializer(node: ts.Node): boolean {
  if (isSetupStaticCall(node, DECLARED_SETUP_STATIC_CALLS)) return true
  return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && DECLARED_SETUP_CONSTRUCTORS.has(node.expression.text)
}

function isSetupWork(node: ts.Node): boolean {
  return isSetupStaticCall(node, SETUP_STATIC_CALLS) ||
    (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && SETUP_CONSTRUCTORS.has(node.expression.text))
}

function isSetupStaticCall(node: ts.Node, allowedCalls: Set<string>): boolean {
  if (!ts.isCallExpression(node)) return false
  const expression = node.expression
  if (ts.isIdentifier(expression)) return allowedCalls.has(expression.text)
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return false
  return allowedCalls.has(`${expression.expression.text}.${expression.name.text}`)
}

function isLargeLiteral(node: ts.Node): boolean {
  if (ts.isArrayLiteralExpression(node)) return node.getText().length >= LARGE_ARRAY_LITERAL_LENGTH
  if (ts.isObjectLiteralExpression(node)) return node.getText().length >= LARGE_OBJECT_LITERAL_LENGTH
  return false
}

function callName(node: ts.CallExpression): string | null {
  const expression = node.expression
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return null
}

function isGlobalObjectExpression(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && GLOBAL_OBJECTS.has(node.text)
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isGetAccessorDeclaration(parent) && parent.name === node) return false
  if (ts.isSetAccessorDeclaration(parent) && parent.name === node) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent) && parent.name === node) return false
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false
  if (ts.isClassDeclaration(parent) && parent.name === node) return false
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false
  if (ts.isTypeReferenceNode(parent)) return false

  return true
}

function firstMeaningfulSnippet(sourceFile: ts.SourceFile): string | null {
  const statement = sourceFile.statements.find(item => item.getText(sourceFile).trim().length > 0)
  return statement ? nodeSnippet(statement) : null
}

function nodeSnippet(node: ts.Node): string {
  return cleanSnippet(node.getText())
}

function cleanSnippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}
