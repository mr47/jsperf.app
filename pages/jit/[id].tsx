import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { Check, Copy, Download, Search } from 'lucide-react'
import SEO from '../../components/SEO'
import Layout from '../../components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { codeLanguageClass, highlightSanitizedCode } from '../../utils/hljs'
import { parseOptimizedBlocks } from '../../utils/jitSourceMap'
import JitSourceMapViewer from '../../components/JitSourceMapViewer'

type JitArtifactDoc = {
  id: string
  runtime?: string
  runtimeName?: string
  version?: string | null
  label?: string | null
  testIndex?: number
  profileLabel?: string
  meta?: {
    sizeBytes?: number
    lineCount?: number
    truncated?: boolean
    captureMode?: string
    source?: string
  }
  output: string
}

export default function JitArtifactPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const [data, setData] = useState<JitArtifactDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)

  useEffect(() => {
    if (!id) return

    let cancelled = false
    setLoading(true)
    fetch(`/api/benchmark/jit-artifact/${id}`)
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || ''
        const body = contentType.includes('application/json')
          ? await res.json().catch(() => null)
          : { error: await formatNonJsonError(res) }
        if (!res.ok) throw new Error(body?.error || 'Failed to load JIT output')
        return body
      })
      .then((body) => {
        if (cancelled) return
        setData(body)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Failed to load JIT output')
        setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  const highlighted = useMemo(() => {
    if (!data?.output) return null
    try {
      return highlightSanitizedCode(data.output, 'x86asm')
    } catch (_) {
      return null
    }
  }, [data?.output])

  const matchCount = useMemo(() => countMatches(data?.output || '', query), [data?.output, query])
  const optimizedBlocks = useMemo(() => parseOptimizedBlocks(data?.output || ''), [data?.output])
  const activeBlock = optimizedBlocks[activeBlockIndex] || optimizedBlocks[0] || null
  const title = data ? `${runtimeLabel(data)} JIT Output` : 'JIT Output'

  useEffect(() => {
    setActiveBlockIndex(0)
  }, [data?.id])

  const copyOutput = async () => {
    if (!data?.output || !navigator.clipboard) return
    await navigator.clipboard.writeText(data.output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <SEO
        title={title}
        description="Inspect captured V8 optimized-code and assembly output from jsPerf Node.js benchmark runs."
        canonical={id ? `/jit/${id}` : undefined}
        ogImage={undefined}
      />
      <Layout>
        <main className="py-4 sm:py-6">
          {loading && (
            <LoadingArtifactShell />
          )}

          {error && (
            <Card className="relative left-1/2 w-[min(96vw,1500px)] -translate-x-1/2 border-red-500/30">
              <CardContent className="p-6 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
            </Card>
          )}

          {data && (
            <Card className="relative left-1/2 w-[min(96vw,1500px)] -translate-x-1/2 overflow-hidden border-border/70 shadow-sm">
              <CardContent className="p-0">
                <div className="flex flex-col gap-3 border-b border-border/70 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <h1 className="truncate text-sm font-semibold tracking-tight">{runtimeLabel(data)}</h1>
                      <span className="text-xs text-muted-foreground">V8 optimized-code</span>
                      {data.meta?.truncated && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                          truncated
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                      <span>{formatBig(data.meta?.lineCount || 0)} lines</span>
                      <span>{formatBytes(data.meta?.sizeBytes || 0)}</span>
                      <span>{data.meta?.captureMode || 'v8-opt-code'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="ghost" size="sm" className="h-8 rounded-md" onClick={copyOutput}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button asChild variant="ghost" size="sm" className="h-8 rounded-md">
                      <a href={`/api/benchmark/jit-artifact/${data.id}?download=1`}>
                        <Download className="h-4 w-4" />
                        Download .txt
                      </a>
                    </Button>
                  </div>
                </div>

                {activeBlock && (
                  <JitSourceMapViewer
                    blocks={optimizedBlocks}
                    activeBlockIndex={activeBlockIndex}
                    onActiveBlockIndexChange={setActiveBlockIndex}
                  />
                )}
                {!activeBlock && data.output && (
                  <div className="border-b border-border/70 bg-amber-500/5 p-5">
                    <div className="rounded-xl border border-amber-500/25 bg-background/80 p-4">
                      <h2 className="text-sm font-semibold text-foreground">No optimized code block in this artifact</h2>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        This capture contains V8 trace lines but no `--- Optimized code ---` disassembly. On newer Node versions this usually means the benchmark only reached Maglev, while this viewer needs TurboFan optimized-code output. Re-run JIT capture with the updated capture flags to generate a source-linked artifact.
                      </p>
                    </div>
                  </div>
                )}

                <div className="border-b border-border/70 p-5">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search output..."
                      aria-label="Search JIT output"
                      className="h-10 w-full rounded-full border border-border bg-background pl-9 pr-4 text-sm outline-none transition-colors focus:border-sky-500"
                    />
                  </label>
                  {query.trim() && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatBig(matchCount)} {matchCount === 1 ? 'match' : 'matches'} for "{query.trim()}"
                    </p>
                  )}
                </div>

                <pre className="m-0 max-h-[70vh] overflow-auto bg-[#f6f8fa] p-4 text-xs leading-relaxed dark:bg-[#0d1117] sm:text-sm">
                  {highlighted
                    ? <code className={`${codeLanguageClass('x86asm', data.output)} block whitespace-pre`} dangerouslySetInnerHTML={{ __html: highlighted }} />
                    : <code className={`${codeLanguageClass('x86asm', data.output)} block whitespace-pre`}>{data.output}</code>}
                </pre>
              </CardContent>
            </Card>
          )}
        </main>
      </Layout>
    </>
  )
}

function LoadingArtifactShell() {
  return (
    <Card className="relative left-1/2 w-[min(96vw,1500px)] -translate-x-1/2 overflow-hidden border-border/70 shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border/70 bg-background px-4 py-3">
          <div>
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-52 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="hidden gap-2 sm:flex">
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted/70" />
            <div className="h-8 w-28 animate-pulse rounded-md bg-muted/70" />
          </div>
        </div>
        <div className="grid min-h-[58vh] xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
            <div className="space-y-3">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="h-3 w-6 animate-pulse rounded bg-muted/70" />
                  <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${55 + (index % 4) * 8}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="p-5">
            <div className="space-y-3">
              {Array.from({ length: 11 }, (_, index) => (
                <div key={index} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${72 + (index % 5) * 5}%` }} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function runtimeLabel(data: JitArtifactDoc | null) {
  if (!data) return 'Runtime'
  return data.label || data.runtimeName || data.runtime || 'Runtime'
}

function formatBytes(n: number) {
  if (!n) return '0B'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function formatBig(n: number) {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function countMatches(value: string, query: string) {
  const needle = query.trim()
  if (!needle) return 0
  return value.toLowerCase().split(needle.toLowerCase()).length - 1
}

async function formatNonJsonError(res: Response) {
  const text = await res.text().catch(() => '')
  return text || `Unexpected response (${res.status})`
}
