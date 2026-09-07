export function benchmarkPath(slug: string, revision?: number) {
  return `/${slug}${revision && revision > 1 ? `/${revision}` : ''}`
}

export function compactBenchmarkPath(slug: string, revision?: number) {
  return `${benchmarkPath(slug, revision)}/compact`
}
