import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Maximize2 } from 'lucide-react'

import SEO from './SEO'
import TestRunner from './TestRunner'
import { Button } from '@/components/ui/button'
import { benchmarkPath, compactBenchmarkPath } from '../lib/benchmark/paths'
import logoBigDark from '../public/logo-big-dark-transparent.png'
import logoBig from '../public/logo-big-transparent.png'

export default function CompactBenchmarkPage({ pageData }) {
  const {
    _id,
    authorName,
    published,
    revision,
    setup,
    slug,
    teardown,
    tests,
    title,
    language,
    languageOptions,
  } = pageData
  const fullPath = benchmarkPath(slug, revision)
  const compactPath = compactBenchmarkPath(slug, revision)
  const benchmarkTitle = `${title}${revision > 1 ? ` (v${revision})` : ''}`

  return (
    <>
      <SEO
        title={`${benchmarkTitle} compact benchmark`}
        description={`Compact benchmark runner for ${benchmarkTitle}.`}
        canonical={compactPath}
        ogImage="/og-image.png"
        noindex={true}
      />

      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <div className="sticky top-0 z-20 -mx-4 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="inline-flex shrink-0 items-center" aria-label="jsPerf home">
                <Image
                  src={logoBig}
                  alt=""
                  className="h-8 w-auto object-contain dark:hidden"
                  aria-hidden="true"
                />
                <Image
                  src={logoBigDark}
                  alt=""
                  className="hidden h-8 w-auto object-contain dark:block"
                  aria-hidden="true"
                />
              </Link>

              <Button asChild variant="outline" size="sm" className="h-8 shrink-0">
                <Link href={fullPath}>
                  <Maximize2 className="h-3.5 w-3.5" />
                  Full view
                </Link>
              </Button>
            </div>

            <div className="mt-3 min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Link href={fullPath} className="inline-flex items-center gap-1 hover:text-foreground">
                  <ArrowLeft className="h-3 w-3" />
                  Full benchmark
                </Link>
                <span aria-hidden="true">/</span>
                <span>{tests.length} case{tests.length === 1 ? '' : 's'}</span>
                {revision > 1 && <span>v{revision}</span>}
              </div>
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                {title}
              </h1>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[authorName ? `by ${authorName}` : null, published ? new Date(published).toLocaleDateString() : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <TestRunner
            id={_id}
            slug={slug}
            revision={revision}
            tests={tests}
            setup={setup}
            teardown={teardown}
            language={language}
            languageOptions={languageOptions}
            compact
          />
        </div>
      </main>
    </>
  )
}
