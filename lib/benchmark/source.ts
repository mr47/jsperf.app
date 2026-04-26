import ts from 'typescript'
import type {
  BenchmarkLanguage,
  BenchmarkTestSource,
  PreparedBenchmarkSources,
  PrepareBenchmarkSourcesInput,
  SourcePartDetails,
  TypeScriptLanguageOptions,
  TypeScriptRuntimeMode,
  TypeScriptTarget,
} from './types'

export const LANGUAGE_JAVASCRIPT = 'javascript'
export const LANGUAGE_TYPESCRIPT = 'typescript'

export const SOURCE_PREP_VERSION = 1

const DEFAULT_TYPESCRIPT_OPTIONS: TypeScriptLanguageOptions = Object.freeze({
  runtimeMode: 'native-where-available',
  target: 'es2020',
  jsx: false,
  typeCheck: false,
  imports: false,
})

const ALLOWED_TARGETS = new Set<TypeScriptTarget>(['es2020', 'es2022', 'esnext'])
const ALLOWED_RUNTIME_MODES = new Set<TypeScriptRuntimeMode>(['native-where-available', 'compiled-everywhere'])
const MODULE_SYNTAX_RE = /(^|[\n;])\s*(import|export)\s/m
const TYPESCRIPT_SYNTAX_RE = [
  /\btype\s+[$A-Z_a-z][$\w]*(?:\s*<[^>{}]*>)?\s*=/,
  /\binterface\s+[$A-Z_a-z][$\w]*(?:\s*<[^>{}]*>)?\s*{/,
  /\benum\s+[$A-Z_a-z][$\w]*\s*{/,
  /\b(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*:\s*[^=;\n]+[=;]/,
  /\bfunction\s+[$A-Z_a-z][$\w]*\s*(?:<[^>{}]*>)?\([^)]*:\s*[^)]*\)\s*(?::\s*[^{]+)?{/,
  /\)\s*:\s*[$A-Z_a-z][$\w]*(?:\[\])?\s*=>/,
  /\bas\s+const\b/,
  /\bas\s+[$A-Z_a-z][$\w]*(?:<[^>{}]*>)?/,
]
const WRAPPER_NAME = '__jsperfTsBody__'

export class SourcePreparationError extends Error {
  details: SourcePartDetails | Record<string, never>

  constructor(message: string, details: SourcePartDetails | Record<string, never> = {}) {
    super(message)
    this.name = 'SourcePreparationError'
    this.details = details
  }
}

export function normalizeBenchmarkLanguage(value?: unknown): BenchmarkLanguage {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'ts' || raw === 'typescript') return LANGUAGE_TYPESCRIPT
  return LANGUAGE_JAVASCRIPT
}

export function inferBenchmarkLanguage({
  language,
  tests,
  setup = '',
  teardown = '',
}: PrepareBenchmarkSourcesInput = {}): BenchmarkLanguage {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : ''
  if (raw) return normalizeBenchmarkLanguage(raw)

  const sources = [
    setup,
    teardown,
    ...(Array.isArray(tests) ? tests.map(test => test?.code || '') : []),
  ].join('\n')

  return hasTypeScriptSyntax(sources) ? LANGUAGE_TYPESCRIPT : LANGUAGE_JAVASCRIPT
}

export function normalizeLanguageOptions(language: unknown, value: unknown = {}): TypeScriptLanguageOptions | null {
  if (normalizeBenchmarkLanguage(language) !== LANGUAGE_TYPESCRIPT) return null

  const input = value && typeof value === 'object' ? value as Partial<TypeScriptLanguageOptions> : {}
  const runtimeMode = ALLOWED_RUNTIME_MODES.has(input.runtimeMode)
    ? input.runtimeMode
    : DEFAULT_TYPESCRIPT_OPTIONS.runtimeMode
  const target = ALLOWED_TARGETS.has(input.target)
    ? input.target
    : DEFAULT_TYPESCRIPT_OPTIONS.target

  return {
    runtimeMode,
    target,
    jsx: input.jsx === true,
    typeCheck: false,
    imports: false,
  }
}

export function isTypeScriptLanguage(language: unknown): boolean {
  return normalizeBenchmarkLanguage(language) === LANGUAGE_TYPESCRIPT
}

export function prepareBenchmarkSources({
  tests,
  setup = '',
  teardown = '',
  language,
  languageOptions,
}: PrepareBenchmarkSourcesInput = {}): PreparedBenchmarkSources {
  const start = nowMs()

  const originalTests: BenchmarkTestSource[] = Array.isArray(tests) ? tests : []
  const normalizedLanguage = inferBenchmarkLanguage({
    language,
    tests: originalTests,
    setup,
    teardown,
  })
  const normalizedOptions = normalizeLanguageOptions(normalizedLanguage, languageOptions)
  if (normalizedLanguage !== LANGUAGE_TYPESCRIPT) {
    return {
      language: LANGUAGE_JAVASCRIPT,
      languageOptions: null,
      compilerVersion: null,
      sourcePrepVersion: SOURCE_PREP_VERSION,
      conversionMs: elapsedMs(start),
      original: {
        tests: originalTests,
        setup: setup || '',
        teardown: teardown || '',
      },
      runtime: {
        tests: originalTests,
        setup: setup || '',
        teardown: teardown || '',
      },
    }
  }

  const sourceParts: Array<SourcePartDetails & { source: string }> = [
    { kind: 'setup', source: setup || '' },
    { kind: 'teardown', source: teardown || '' },
    ...originalTests.map((test, index) => ({
      kind: 'test' as const,
      index,
      source: test?.code || '',
      title: test?.title,
    })),
  ]
  for (const part of sourceParts) {
    assertSupportedTypeScriptSource(part.source, normalizedOptions, part)
  }

  const runtimeSetup = transpileStatements(setup || '', normalizedOptions, { kind: 'setup' })
  const runtimeTeardown = transpileStatements(teardown || '', normalizedOptions, { kind: 'teardown' })
  const runtimeTests = originalTests.map((test, index) => ({
    ...test,
    originalCode: test.code,
    code: transpileFunctionBody(test.code || '', normalizedOptions, {
      kind: 'test',
      index,
      title: test.title,
    }),
    sourceLanguage: LANGUAGE_TYPESCRIPT,
  }))

  return {
    language: LANGUAGE_TYPESCRIPT,
    languageOptions: normalizedOptions,
    compilerVersion: ts.version,
    sourcePrepVersion: SOURCE_PREP_VERSION,
    conversionMs: elapsedMs(start),
    original: {
      tests: originalTests,
      setup: setup || '',
      teardown: teardown || '',
    },
    runtime: {
      tests: runtimeTests,
      setup: runtimeSetup,
      teardown: runtimeTeardown,
    },
  }
}

function assertSupportedTypeScriptSource(source: string, options: TypeScriptLanguageOptions, details: SourcePartDetails): void {
  if (options.imports === false && MODULE_SYNTAX_RE.test(source || '')) {
    throw new SourcePreparationError(
      'TypeScript benchmark snippets do not support import/export syntax yet.',
      details,
    )
  }
}

function hasTypeScriptSyntax(source: string): boolean {
  return TYPESCRIPT_SYNTAX_RE.some(pattern => pattern.test(source))
}

function transpileStatements(source: string, options: TypeScriptLanguageOptions, details: SourcePartDetails): string {
  if (!source) return ''
  return transpile(source, options, details).trim()
}

function transpileFunctionBody(source: string, options: TypeScriptLanguageOptions, details: SourcePartDetails): string {
  if (!source) return ''
  const wrapped = `async function ${WRAPPER_NAME}() {\n${source}\n}`
  const output = transpile(wrapped, options, details)
  return extractWrappedBody(output, details).trim()
}

function transpile(source: string, options: TypeScriptLanguageOptions, details: SourcePartDetails): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: targetFor(options.target),
      module: ts.ModuleKind.ESNext,
      jsx: options.jsx ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues?.Remove,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      removeComments: false,
    },
    reportDiagnostics: true,
  })

  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    throw new SourcePreparationError(formatDiagnostics(errors), details)
  }

  return stripUseStrict(result.outputText || '')
}

function extractWrappedBody(output: string, details: SourcePartDetails): string {
  const marker = `function ${WRAPPER_NAME}`
  const fnIndex = output.indexOf(marker)
  if (fnIndex < 0) {
    throw new SourcePreparationError('Unable to compile TypeScript benchmark body.', details)
  }
  const openIndex = output.indexOf('{', fnIndex)
  const closeIndex = output.lastIndexOf('}')
  if (openIndex < 0 || closeIndex <= openIndex) {
    throw new SourcePreparationError('Unable to read compiled TypeScript benchmark body.', details)
  }
  return output.slice(openIndex + 1, closeIndex)
}

function targetFor(target: TypeScriptTarget): ts.ScriptTarget {
  if (target === 'esnext') return ts.ScriptTarget.ESNext
  if (target === 'es2022') return ts.ScriptTarget.ES2022
  return ts.ScriptTarget.ES2020
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    .filter(Boolean)
    .join('\n') || 'Failed to compile TypeScript benchmark source.'
}

function stripUseStrict(output: string): string {
  return output.replace(/^["']use strict["'];\s*/, '')
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function elapsedMs(start: number): number {
  return Math.max(0, Math.round((nowMs() - start) * 100) / 100)
}
