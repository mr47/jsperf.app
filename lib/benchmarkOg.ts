type BenchmarkOgVersionInput = {
  title?: string
  revision?: number | string
  published?: string | Date | null
  language?: string | null
  tests?: Array<{
    title?: string
    code?: string
    async?: boolean
  }>
}

export function benchmarkOgVersion(pageData: BenchmarkOgVersionInput) {
  const tests = Array.isArray(pageData.tests) ? pageData.tests : []
  const signature = JSON.stringify({
    title: pageData.title || '',
    revision: pageData.revision || 1,
    published: pageData.published || '',
    language: pageData.language || 'javascript',
    tests: tests.map((test) => [
      test?.title || '',
      typeof test?.code === 'string' ? test.code.length : 0,
      !!test?.async,
    ]),
  })

  return stableHash(signature)
}

export function benchmarkOgImagePath({
  slug,
  revision,
  version,
}: {
  slug: string
  revision?: number | string
  version?: string
}) {
  const params = new URLSearchParams({ slug })
  const rev = Number.parseInt(String(revision || 1), 10)

  params.set('revision', Number.isFinite(rev) && rev > 0 ? String(rev) : '1')
  if (version) params.set('v', version)

  return `/api/benchmark-og?${params.toString()}`
}

function stableHash(input: string) {
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}
