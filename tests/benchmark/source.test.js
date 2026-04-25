import { describe, expect, it } from 'vitest'
import {
  normalizeBenchmarkLanguage,
  normalizeLanguageOptions,
  prepareBenchmarkSources,
  SourcePreparationError,
} from '../../lib/benchmark/source.js'
import { TYPESCRIPT_SEED_BENCHMARKS } from '../../lib/benchmark/typescriptSeeds.js'

describe('benchmark source preparation', () => {
  it('defaults unknown languages to JavaScript', () => {
    expect(normalizeBenchmarkLanguage()).toBe('javascript')
    expect(normalizeBenchmarkLanguage('js')).toBe('javascript')
    expect(normalizeBenchmarkLanguage('ts')).toBe('typescript')
  })

  it('normalizes TypeScript options conservatively', () => {
    expect(normalizeLanguageOptions('typescript', {
      runtimeMode: 'compiled-everywhere',
      target: 'esnext',
      jsx: true,
      typeCheck: true,
      imports: true,
    })).toEqual({
      runtimeMode: 'compiled-everywhere',
      target: 'esnext',
      jsx: true,
      typeCheck: false,
      imports: false,
    })
  })

  it('passes JavaScript through without a compiler', () => {
    const prepared = prepareBenchmarkSources({
      language: 'javascript',
      tests: [{ title: 'plain', code: 'return x + 1' }],
      setup: 'const x = 1',
    })

    expect(prepared.language).toBe('javascript')
    expect(prepared.compilerVersion).toBeNull()
    expect(prepared.runtime.tests[0].code).toBe('return x + 1')
    expect(prepared.runtime.setup).toBe('const x = 1')
  })

  it('compiles TypeScript setup and function-body snippets to JavaScript', () => {
    const prepared = prepareBenchmarkSources({
      language: 'typescript',
      tests: [{
        title: 'typed',
        code: 'type Box = { value: number }\nconst box: Box = { value: seed }\nreturn box.value as number',
      }],
      setup: 'const seed: number = 42',
      teardown: 'const done: boolean = true',
    })

    expect(prepared.language).toBe('typescript')
    expect(prepared.compilerVersion).toEqual(expect.any(String))
    expect(prepared.conversionMs).toEqual(expect.any(Number))
    expect(prepared.runtime.setup).toContain('const seed = 42')
    expect(prepared.runtime.teardown).toContain('const done = true')
    expect(prepared.runtime.tests[0].code).toContain('const box = { value: seed }')
    expect(prepared.runtime.tests[0].code).toContain('return box.value')
    expect(prepared.runtime.tests[0].code).not.toContain('type Box')
  })

  it('rejects imports and exports in the first TypeScript pass', () => {
    expect(() => prepareBenchmarkSources({
      language: 'typescript',
      tests: [{ title: 'import', code: 'import { x } from "pkg"\nreturn x' }],
    })).toThrow(SourcePreparationError)
  })

  it('keeps TypeScript seed benchmarks compilable', () => {
    for (const seed of TYPESCRIPT_SEED_BENCHMARKS) {
      const prepared = prepareBenchmarkSources({
        language: 'typescript',
        setup: seed.setup,
        tests: seed.tests,
      })

      expect(prepared.runtime.tests).toHaveLength(seed.tests.length)
      for (const test of prepared.runtime.tests) {
        expect(test.code).not.toMatch(/\btype\s+\w+/)
        expect(test.code).not.toContain(': number')
      }
    }
  })
})
