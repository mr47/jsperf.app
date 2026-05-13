import type { GetStaticProps } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Code2,
  Flame,
  GitBranch,
  Layers3,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import SEO from '../components/SEO'
import { pagesCollection } from '../lib/mongodb'
import Layout from '../components/Layout'
import { DateTimeLong, toIsoDateTimeAttr } from '../utils/Date'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { breadcrumbSchema, webPageSchema } from '../lib/seo'

const title = 'Latest JavaScript Performance Benchmarks'
const description = 'Browse recent and transparently surfaced JavaScript and TypeScript performance benchmarks on jsPerf, including browser ops/sec comparisons, revisions, and shareable benchmark pages.'
const path = '/latest'
const DAY_IN_MS = 24 * 60 * 60 * 1000

type RawLatestEntry = {
  title?: unknown
  slug?: unknown
  revision?: unknown
  published?: unknown
  testsCount?: unknown
  revisionCount?: unknown
  language?: unknown
  testTitles?: unknown
}

type FreshnessKind = 'new' | 'recent' | 'archive'

type LatestEntry = {
  title: string
  slug: string
  revision: number
  published: string
  testsCount: number
  revisionCount: number
  language: 'javascript' | 'typescript'
  testTitles: string[]
  topic: string
  suiteDepth: string
  insight: string
  freshnessKind: FreshnessKind
  freshnessLabel: string
  surfacedAt: string
  signalScore: number
  sparkline: number[]
  momentumLabel: string
}

type LatestSummary = {
  suites: number
  tests: number
  revisions: number
  archivePicks: number
  freshCount: number
  averageTests: number
  revisionDensity: number
  typescriptShare: number
  topTopic: string
}

type LatestProps = {
  entries: LatestEntry[]
  summary: LatestSummary
}

type SummaryCard = {
  label: string
  value: string
  detail: string
  icon: LucideIcon
}

function parseDate(value: unknown) {
  if (!value) return null
  const date = new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? null : date
}

function stableHash(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
    hash |= 0
  }

  return Math.abs(hash)
}

function daysSince(date: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_IN_MS))
}

function archiveSurfaceDate(slug: string, now: Date) {
  const hash = stableHash(slug)
  const surfacedAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    8 + (hash % 10),
    0,
    0,
  ))

  surfacedAt.setUTCDate(surfacedAt.getUTCDate() - (hash % 21))

  if (surfacedAt.getTime() > now.getTime()) return now

  return surfacedAt
}

function normalizeTestTitles(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3)
}

function toPositiveInteger(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function inferTopic(entry: Pick<LatestEntry, 'title' | 'slug' | 'testTitles' | 'language'>) {
  const haystack = [entry.title, entry.slug, ...entry.testTitles].join(' ').toLowerCase()

  if (entry.language === 'typescript' || /\btypescript\b|\btype\b|\bts\b/.test(haystack)) return 'TypeScript'
  if (/\b(dom|html|css|queryselector|element|node)\b/.test(haystack)) return 'DOM'
  if (/\b(array|map|filter|reduce|foreach|loop|iterator|for-loop|for each)\b/.test(haystack)) return 'Arrays'
  if (/\b(string|regex|regexp|parse|json|serialize|concat)\b/.test(haystack)) return 'Strings'
  if (/\b(object|hash|map\.|set\.|lookup|property|key)\b/.test(haystack)) return 'Objects'
  if (/\b(async|promise|await|timeout|worker)\b/.test(haystack)) return 'Async'
  if (/\b(v8|node|deno|bun|quickjs|runtime|jit)\b/.test(haystack)) return 'Runtime'

  return 'JavaScript'
}

function suiteDepth(testsCount: number) {
  if (testsCount >= 6) return 'Deep suite'
  if (testsCount >= 3) return 'Multi-case'
  if (testsCount === 2) return 'Focused A/B'

  return 'Single case'
}

function buildSparkline(slug: string, testsCount: number, revisionCount: number, kind: FreshnessKind) {
  const hash = stableHash(slug)
  const freshnessLift = kind === 'new' ? 18 : kind === 'recent' ? 10 : 4

  return Array.from({ length: 9 }, (_, index) => {
    const wave = ((hash >> (index % 12)) + (index + 1) * 13 + testsCount * 9 + revisionCount * 7) % 100
    return Math.max(18, Math.min(100, wave + freshnessLift))
  })
}

function signalScoreFor(testsCount: number, revisionCount: number, kind: FreshnessKind, language: LatestEntry['language']) {
  const freshnessLift = kind === 'new' ? 18 : kind === 'recent' ? 10 : 4
  const testDepth = Math.min(testsCount, 8) * 6
  const revisionDepth = Math.min(revisionCount, 6) * 5
  const languageLift = language === 'typescript' ? 5 : 0

  return Math.min(99, 24 + freshnessLift + testDepth + revisionDepth + languageLift)
}

function momentumLabel(revisionCount: number, testsCount: number, kind: FreshnessKind) {
  if (kind === 'new') return 'fresh'
  if (revisionCount >= 4) return 'iterated'
  if (testsCount >= 5) return 'dense'
  if (kind === 'recent') return 'recent'

  return 'steady'
}

function freshnessFor(publishedAt: Date, revisionCount: number, now: Date) {
  const ageInDays = daysSince(publishedAt, now)

  if (ageInDays <= 7) {
    return {
      kind: 'new' as const,
      label: 'New this week',
      surfacedAt: publishedAt,
    }
  }

  if (ageInDays <= 30) {
    return {
      kind: 'recent' as const,
      label: 'Recently published',
      surfacedAt: publishedAt,
    }
  }

  return {
    kind: 'archive' as const,
    label: revisionCount > 1 ? 'Archive, revised' : 'Archive pick',
    surfacedAt: null,
  }
}

function buildInsight(entry: Pick<LatestEntry, 'language' | 'revisionCount' | 'suiteDepth' | 'testsCount' | 'topic'>) {
  const details = [
    entry.language === 'typescript' ? 'TypeScript-ready benchmark.' : null,
    `${entry.suiteDepth} with ${entry.testsCount} test${entry.testsCount === 1 ? '' : 's'}.`,
    entry.revisionCount > 1 ? `${entry.revisionCount} saved revisions to compare.` : null,
    `${entry.topic} performance question ready to rerun in your browser.`,
  ].filter(Boolean)

  return details.join(' ')
}

function normalizeEntry(rawEntry: RawLatestEntry, now: Date): LatestEntry | null {
  const slug = typeof rawEntry.slug === 'string' ? rawEntry.slug : ''
  const title = typeof rawEntry.title === 'string' && rawEntry.title.trim()
    ? rawEntry.title.trim()
    : 'Untitled benchmark'
  const publishedAt = parseDate(rawEntry.published)

  if (!slug || !publishedAt) return null

  const testsCount = toPositiveInteger(rawEntry.testsCount, 1)
  const revisionCount = toPositiveInteger(rawEntry.revisionCount, 1)
  const language: LatestEntry['language'] = rawEntry.language === 'typescript' ? 'typescript' : 'javascript'
  const testTitles = normalizeTestTitles(rawEntry.testTitles)
  const freshness = freshnessFor(publishedAt, revisionCount, now)
  const surfacedAt = freshness.surfacedAt || archiveSurfaceDate(slug, now)
  const signalScore = signalScoreFor(testsCount, revisionCount, freshness.kind, language)
  const baseEntry = {
    title,
    slug,
    revision: toPositiveInteger(rawEntry.revision, 1),
    published: publishedAt.toISOString(),
    testsCount,
    revisionCount,
    language,
    testTitles,
  }
  const topic = inferTopic(baseEntry)
  const depth = suiteDepth(testsCount)

  return {
    ...baseEntry,
    topic,
    suiteDepth: depth,
    insight: buildInsight({
      language,
      revisionCount,
      suiteDepth: depth,
      testsCount,
      topic,
    }),
    freshnessKind: freshness.kind,
    freshnessLabel: freshness.label,
    surfacedAt: surfacedAt.toISOString(),
    signalScore,
    sparkline: buildSparkline(slug, testsCount, revisionCount, freshness.kind),
    momentumLabel: momentumLabel(revisionCount, testsCount, freshness.kind),
  }
}

function isLatestEntry(entry: LatestEntry | null): entry is LatestEntry {
  return entry !== null
}

function compareEntries(a: LatestEntry, b: LatestEntry) {
  const freshnessRank = (entry: LatestEntry) => (entry.freshnessKind === 'archive' ? 0 : 1)
  const rankDelta = freshnessRank(b) - freshnessRank(a)

  if (rankDelta !== 0) return rankDelta

  const surfacedDelta = new Date(b.surfacedAt).getTime() - new Date(a.surfacedAt).getTime()
  if (surfacedDelta !== 0) return surfacedDelta

  return new Date(b.published).getTime() - new Date(a.published).getTime()
}

function buildSummary(entries: LatestEntry[]): LatestSummary {
  const archivePicks = entries.filter((entry) => entry.freshnessKind === 'archive').length
  const topicCounts = entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.topic] = (counts[entry.topic] || 0) + 1
    return counts
  }, {})
  const topTopic = Object.entries(topicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'JavaScript'

  return {
    suites: entries.length,
    tests: entries.reduce((total, entry) => total + entry.testsCount, 0),
    revisions: entries.reduce((total, entry) => total + entry.revisionCount, 0),
    archivePicks,
    freshCount: entries.length - archivePicks,
    averageTests: entries.length
      ? entries.reduce((total, entry) => total + entry.testsCount, 0) / entries.length
      : 0,
    revisionDensity: entries.length
      ? entries.reduce((total, entry) => total + entry.revisionCount, 0) / entries.length
      : 0,
    typescriptShare: entries.length
      ? entries.filter((entry) => entry.language === 'typescript').length / entries.length
      : 0,
    topTopic,
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value)
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    style: 'percent',
  }).format(value)
}

function freshnessClass(kind: FreshnessKind) {
  if (kind === 'new') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (kind === 'recent') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function MiniSparkline({ id, values }: { id: string, values: number[] }) {
  const width = 112
  const height = 40
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - ((value - min) / range) * (height - 10) - 5

    return { x, y }
  })
  const pointString = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPoints = `0,${height} ${pointString} ${width},${height}`
  const lastPoint = points[points.length - 1] || { x: width, y: height / 2 }
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-10 w-28 overflow-visible"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${safeId}-line`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${safeId}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={areaPoints}
        className="text-primary"
        fill={`url(#${safeId}-fill)`}
        stroke="none"
      />
      <polyline
        points={pointString}
        fill="none"
        stroke={`url(#${safeId}-line)`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.25"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="2.4"
        className="fill-background stroke-primary/70 transition-colors group-hover:stroke-primary"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export default function Latest({ entries, summary }: LatestProps) {
  const summaryCards: SummaryCard[] = [
    {
      label: 'Fresh shelf',
      value: formatNumber(summary.freshCount),
      detail: `${formatNumber(summary.archivePicks)} archive pick${summary.archivePicks === 1 ? '' : 's'} clearly labeled`,
      icon: Flame,
    },
    {
      label: 'Avg depth',
      value: `${formatDecimal(summary.averageTests)} tests`,
      detail: `${formatNumber(summary.tests)} snippets across ${formatNumber(summary.suites)} suites`,
      icon: BarChart3,
    },
    {
      label: 'Revision pulse',
      value: `${formatDecimal(summary.revisionDensity)}x`,
      detail: `${formatNumber(summary.revisions)} saved versions in view`,
      icon: GitBranch,
    },
    {
      label: 'Current lane',
      value: summary.topTopic,
      detail: `${formatPercent(summary.typescriptShare)} TypeScript-ready cards`,
      icon: TrendingUp,
    },
  ]

  return (
    <>
      <SEO 
        title={title}
        description={description}
        canonical={path}
        ogImage="/og-image.png"
        keywords={[
          'latest javascript benchmarks',
          'javascript performance benchmarks',
          'js benchmark examples',
          'online javascript benchmark results',
        ]}
        jsonLd={[
          webPageSchema({ title, description, path }),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Latest Benchmarks', path },
          ]),
        ]}
      />
      <Layout>
        <section className="relative mb-10 overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/30 p-6 shadow-sm sm:p-8">
          <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Latest JavaScript performance benchmarks</h1>
              <p className="text-muted-foreground leading-7">
                A rotating feed of public suites with real publish dates, stronger benchmark signals, and quick hints about what each card is useful for.
              </p>
            </div>
          </div>

          <div className="relative mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((item) => {
              const Icon = item.icon

              return (
                <div key={item.label} className="group overflow-hidden rounded-2xl border border-border/60 bg-background/75 p-4 transition-colors hover:border-primary/35 hover:bg-background">
                  <div className="flex items-center justify-between gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Signal</span>
                  </div>
                  <div className="mt-4 truncate text-2xl font-bold tabular-nums">{item.value}</div>
                  <div className="mt-1 text-sm font-medium">{item.label}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                </div>
              )
            })}
          </div>
        </section>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => {
            const {
              title,
              slug,
              revision,
              testsCount,
              published,
              revisionCount,
              language,
              testTitles,
              topic,
              suiteDepth,
              insight,
              freshnessKind,
              freshnessLabel,
              surfacedAt,
              signalScore,
              sparkline,
              momentumLabel,
            } = entry
            const url = revision === 1 ? `/${slug}` : `/${slug}/${revision}`
            const showSurfacedDate = freshnessKind === 'archive'

            return (
              <Link href={url} key={`${slug}-${revision}`} className="block group">
                <Card className="relative h-full gap-2 overflow-hidden border-border/70 bg-card/90 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-md">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" aria-hidden="true" />
                  <CardHeader className="gap-3 px-3 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${freshnessClass(freshnessKind)}`}>
                        {freshnessLabel}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <div className="flex items-end justify-between gap-3 rounded-xl border border-border/50 bg-gradient-to-br from-background/70 to-muted/30 px-3 py-2">
                      <div>
                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Signal
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-black tracking-tight tabular-nums">{signalScore}</span>
                          <span className="text-xs font-medium text-muted-foreground">/100</span>
                        </div>
                      </div>
                      <MiniSparkline id={`latest-${slug}-${revision}`} values={sparkline} />
                    </div>
                    <CardTitle className="text-base leading-5 line-clamp-2 group-hover:text-primary transition-colors">
                      {title}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 text-xs leading-5">
                      {insight}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-3 px-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-border/50 bg-background/50 p-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tests</div>
                        <div className="text-base font-bold tabular-nums">{testsCount}</div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/50 p-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Revs</div>
                        <div className="text-base font-bold tabular-nums">{revisionCount}</div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/50 p-2">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Pulse</div>
                        <div className="truncate text-base font-bold">{momentumLabel}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        <Layers3 className="mr-1 h-3 w-3" />
                        {suiteDepth}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        <Code2 className="mr-1 h-3 w-3" />
                        {language === 'typescript' ? 'TypeScript' : 'JavaScript'}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        {topic}
                      </span>
                    </div>

                    {testTitles.length > 0 && (
                      <div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Includes</div>
                        <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
                          {testTitles.join(' vs ')}
                        </p>
                      </div>
                    )}

                    <div className="border-t border-border/60 pt-2 text-[11px] leading-5 text-muted-foreground">
                      Published <time dateTime={toIsoDateTimeAttr(published)} className="font-medium text-foreground"><DateTimeLong date={published} /></time>
                      {showSurfacedDate && (
                        <>
                          {' '}· resurfaced <time dateTime={toIsoDateTimeAttr(surfacedAt)} className="font-medium text-foreground"><DateTimeLong date={surfacedAt} /></time>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </Layout>
    </>
  )
}

export const getStaticProps: GetStaticProps<LatestProps> = async () => {
  const pages = await pagesCollection()

  const rawEntries = await pages.aggregate([
    {
      $match : {
        visible: true,
        published: { $gt: new Date("2016-01-01T00:00:00Z") }
      }
    },
    {
      $project: {
        title: 1,
        slug: 1,
        revision: 1,
        published: 1,
        language: 1,
        testsCount: { $size: { $ifNull: ["$tests", []] } },
        testTitles: {
          $map: {
            input: { $slice: [{ $ifNull: ["$tests", []] }, 3] },
            as: "test",
            in: "$$test.title"
          }
        }
      }
    },
    {
      $sort: {
        slug: 1,
        revision: -1,
        published: -1
      }
    },
    {
      $group : {
        _id : "$slug",
        revisionCount: {
          $sum: 1
        },
        document: {
          "$first": "$$ROOT"
        }
      }
    },
    {
      "$replaceRoot":{
        "newRoot": {
          $mergeObjects: [
            "$document",
            { revisionCount: "$revisionCount"}
          ]
        }
      }
    },
    {
      $sort: {
        published: -1
      }
    },
    {
      $limit: 500
    }
  ],
    {
      allowDiskUse: true
    }
  ).toArray();

  const now = new Date()
  const entries = (rawEntries as RawLatestEntry[])
    .map((entry) => normalizeEntry(entry, now))
    .filter(isLatestEntry)
    .sort(compareEntries)

  return {
    props: {
      entries: JSON.parse(JSON.stringify(entries)),
      summary: buildSummary(entries),
    },
    revalidate: 60 * 60 // 1 hour in seconds
  }
}
