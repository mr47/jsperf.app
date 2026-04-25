export type BenchmarkLanguage = 'javascript' | 'typescript'

export type TypeScriptRuntimeMode = 'native-where-available' | 'compiled-everywhere'
export type TypeScriptTarget = 'es2020' | 'es2022' | 'esnext'

export interface TypeScriptLanguageOptions {
  runtimeMode: TypeScriptRuntimeMode
  target: TypeScriptTarget
  jsx: boolean
  typeCheck: false
  imports: false
}

export interface BenchmarkTestSource {
  title?: string
  code?: string
  runtimeCode?: string
  originalCode?: string
  async?: boolean
  [key: string]: unknown
}

export interface PreparedBenchmarkTestSource extends BenchmarkTestSource {
  originalCode: string | undefined
  code: string
  sourceLanguage: 'typescript'
}

export interface PrepareBenchmarkSourcesInput {
  tests?: BenchmarkTestSource[]
  setup?: string
  teardown?: string
  language?: unknown
  languageOptions?: unknown
}

export interface PreparedBenchmarkSources {
  language: BenchmarkLanguage
  languageOptions: TypeScriptLanguageOptions | null
  compilerVersion: string | null
  sourcePrepVersion: number
  conversionMs: number
  original: {
    tests: BenchmarkTestSource[]
    setup: string
    teardown: string
  }
  runtime: {
    tests: Array<BenchmarkTestSource | PreparedBenchmarkTestSource>
    setup: string
    teardown: string
  }
}

export interface SourcePartDetails {
  kind: 'setup' | 'teardown' | 'test'
  index?: number
  title?: string
}

export interface TypeScriptSeedBenchmark {
  id: string
  title: string
  description: string
  setup: string
  tests: Array<{
    title: string
    code: string
  }>
}

export interface BenchmarkSample {
  iters: number
  ms: number
}

export interface BenchmarkStatsOptions {
  iterations?: number
  totalMs?: number
  sliceMs?: number
}
