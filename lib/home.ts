import { analysesCollection, pagesCollection, reportsCollection, runsCollection } from './mongodb'
import { loadBenchmarkPageData } from './benchmark/pageData'
import { bumpDateIfOld } from '../utils/DateBump'
import { HOME_DEMO_SLUG, type HomeData, type HomeDemoBenchmark, type HomeLatestBenchmark, type HomeStats } from './homeShared'

export * from './homeShared'

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

async function loadStats(): Promise<HomeStats> {
  const [pages, runs, analyses, reports] = await Promise.all([
    pagesCollection(), runsCollection(), analysesCollection(), reportsCollection(),
  ])

  const [pageAgg, runsCount, analysesCount, reportsCount] = await Promise.all([
    pages.aggregate([
      { $match: { visible: true } },
      { $group: { _id: null, benchmarks: { $sum: 1 }, testCases: { $sum: { $size: { $ifNull: ['$tests', []] } } } } },
    ]).toArray(),
    runs.estimatedDocumentCount(),
    analyses.estimatedDocumentCount(),
    reports.estimatedDocumentCount(),
  ])

  const first = pageAgg[0] as { benchmarks?: number; testCases?: number } | undefined
  return {
    benchmarks: first?.benchmarks ?? 0,
    testCases: first?.testCases ?? 0,
    runs: runsCount,
    analyses: analysesCount,
    reports: reportsCount,
  }
}

/**
 * Latest public benchmarks, one entry per slug (newest revision), most
 * recently published first. Mirrors the grouping used by /latest.
 */
async function loadLatest(limit: number): Promise<HomeLatestBenchmark[]> {
  const pages = await pagesCollection()
  const rows = await pages.aggregate([
    { $match: { visible: true, published: { $gt: new Date('2016-01-01T00:00:00Z') }, 'tests.0': { $exists: true } } },
    { $project: { title: 1, slug: 1, revision: 1, published: 1, language: 1, testsCount: { $size: { $ifNull: ['$tests', []] } } } },
    { $sort: { slug: 1, revision: -1 } },
    { $group: { _id: '$slug', revisionCount: { $sum: 1 }, document: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$document', { revisionCount: '$revisionCount' }] } } },
    { $sort: { published: -1 } },
    { $limit: limit },
  ], { allowDiskUse: true }).toArray()

  return rows.map((row) => {
    const slug = asString(row.slug)
    const publishedRaw = row.published instanceof Date ? row.published : new Date(String(row.published))
    const published = bumpDateIfOld(publishedRaw, slug)
    return {
      slug,
      revision: Number(row.revision) || 1,
      title: asString(row.title, 'Untitled benchmark'),
      published: new Date(published).toISOString(),
      testsCount: Number(row.testsCount) || 0,
      revisionCount: Number(row.revisionCount) || 1,
      language: row.language === 'typescript' ? 'typescript' : 'javascript',
    }
  })
}

async function loadDemo(): Promise<HomeDemoBenchmark | null> {
  const data = await loadBenchmarkPageData(HOME_DEMO_SLUG)
  if (!data) return null
  const page = data.pageData
  const tests = Array.isArray(page.tests) ? page.tests : []
  if (tests.length === 0) return null
  return {
    id: String(page._id),
    slug: asString(page.slug, HOME_DEMO_SLUG),
    revision: Number(page.revision) || 1,
    title: asString(page.title, 'Demo benchmark'),
    tests: tests.map((test: { title?: unknown; code?: unknown }) => ({ title: asString(test.title), code: asString(test.code) })),
    setup: asString(page.setup),
    teardown: asString(page.teardown),
    language: asString(page.language, 'javascript'),
    languageOptions: page.languageOptions ?? null,
  }
}

export async function loadHomeData(): Promise<HomeData> {
  const [stats, latest, demo] = await Promise.all([loadStats(), loadLatest(6), loadDemo()])
  return { stats, latest, demo }
}
