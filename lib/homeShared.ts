/**
 * Client-safe types and constants for the home page. `lib/home.ts` (server
 * only — it imports the MongoDB driver) re-exports these; components must
 * import from here so the driver never lands in the browser bundle.
 */

/** Slug of the benchmark embedded as the interactive demo on the home page. */
export const HOME_DEMO_SLUG = 'synthetic-commerce-jit-cpu-profile'

export type HomeStats = {
  benchmarks: number
  testCases: number
  runs: number
  analyses: number
  reports: number
}

export type HomeLatestBenchmark = {
  slug: string
  revision: number
  title: string
  published: string
  testsCount: number
  revisionCount: number
  language: 'javascript' | 'typescript'
}

export type HomeDemoBenchmark = {
  id: string
  slug: string
  revision: number
  title: string
  tests: Array<{ title: string; code: string }>
  setup: string
  teardown: string
  language: string
  languageOptions: unknown
}

export type HomeData = {
  stats: HomeStats
  latest: HomeLatestBenchmark[]
  demo: HomeDemoBenchmark | null
}
