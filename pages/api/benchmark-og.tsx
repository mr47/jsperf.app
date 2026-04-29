import { ImageResponse } from 'next/og'
import type { NextApiRequest, NextApiResponse } from 'next'

import { pagesCollection } from '../../lib/mongodb'

const IMAGE_WIDTH = 1200
const IMAGE_HEIGHT = 630
const MAX_TESTS_SHOWN = 4

type BenchmarkTest = {
  title?: string
  async?: boolean
}

type BenchmarkOgData = {
  title?: string
  slug?: string
  revision?: number
  published?: string | Date | null
  language?: string | null
  tests?: BenchmarkTest[]
  mirror?: boolean
  visible?: boolean
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const slug = readQueryString(req.query.slug)
  const revision = readRevision(req.query.revision)

  if (!slug || !revision) {
    return res.status(400).json({ error: 'Missing slug or revision' })
  }

  try {
    const pages = await pagesCollection()
    const pageData = await pages.findOne(
      { slug, revision },
      {
        projection: {
          title: 1,
          slug: 1,
          revision: 1,
          published: 1,
          language: 1,
          tests: 1,
          mirror: 1,
          visible: 1,
        },
      },
    ) as BenchmarkOgData | null

    if (!pageData || pageData.visible === false) {
      return res.status(404).json({ error: 'Benchmark not found' })
    }

    const image = new ImageResponse(<BenchmarkOgImage benchmark={pageData} />, {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    })

    const body = Buffer.from(await image.arrayBuffer())

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', cacheControlForVersion(readQueryString(req.query.v)))
    res.setHeader('Content-Length', String(body.byteLength))
    return res.status(200).send(body)
  } catch (error) {
    console.error('benchmark-og: render failed', error)
    return res.status(500).json({ error: 'Failed to render benchmark image' })
  }
}

function BenchmarkOgImage({ benchmark }: { benchmark: BenchmarkOgData }) {
  const title = truncate(benchmark.title || 'Untitled benchmark', 86)
  const revision = Number.isFinite(benchmark.revision) ? benchmark.revision : 1
  const tests = Array.isArray(benchmark.tests) ? benchmark.tests : []
  const languageLabel = benchmark.language === 'typescript' ? 'TypeScript' : 'JavaScript'
  const published = formatDate(benchmark.published)
  const shownTests = tests.slice(0, MAX_TESTS_SHOWN)
  const extraTests = Math.max(0, tests.length - shownTests.length)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #020617 0%, #10172a 48%, #312e81 100%)',
        color: '#f8fafc',
        padding: 64,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 58,
              height: 58,
              borderRadius: 18,
              background: '#f8fafc',
              color: '#020617',
            }}
          >
            js
          </div>
          <span>jsPerf</span>
        </div>
        <div
          style={{
            display: 'flex',
            padding: '12px 22px',
            borderRadius: 999,
            background: 'rgba(248, 250, 252, 0.12)',
            border: '1px solid rgba(248, 250, 252, 0.22)',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {languageLabel} benchmark
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div
          style={{
            display: 'flex',
            color: '#a5b4fc',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          {revision > 1 ? `Revision ${revision}` : 'Benchmark'} · {published}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: title.length > 62 ? 62 : 74,
            lineHeight: 1.02,
            fontWeight: 900,
            letterSpacing: -3,
            maxWidth: 980,
          }}
        >
          {title}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {shownTests.map((test, index) => (
            <div
              key={`${test.title || index}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px',
                borderRadius: 18,
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                fontSize: 24,
                color: '#e2e8f0',
              }}
            >
              <span style={{ color: '#818cf8', fontWeight: 800 }}>#{index + 1}</span>
              <span>{truncate(test.title || `Test ${index + 1}`, 28)}</span>
              {test.async ? <span style={{ color: '#38bdf8' }}>async</span> : null}
            </div>
          ))}
          {extraTests > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 18px',
                borderRadius: 18,
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                fontSize: 24,
                color: '#cbd5e1',
              }}
            >
              +{extraTests} more
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#cbd5e1',
          fontSize: 28,
        }}
      >
        <span>{tests.length} test{tests.length === 1 ? '' : 's'} · online ops/sec comparison</span>
        <span>{benchmark.mirror ? 'jsPerf.com mirror' : 'jsperf.net'}</span>
      </div>
    </div>
  )
}

function readQueryString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function readRevision(value: string | string[] | undefined) {
  const revision = Number.parseInt(readQueryString(value) || '1', 10)
  return Number.isFinite(revision) && revision > 0 ? revision : null
}

function cacheControlForVersion(version?: string) {
  return version
    ? 'public, max-age=31536000, s-maxage=31536000, immutable'
    : 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'Shareable preview'

  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Shareable preview'

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}
