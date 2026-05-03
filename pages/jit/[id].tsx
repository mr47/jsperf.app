import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { Check, Copy, Cpu, Download, Search } from 'lucide-react'
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
        description="Inspect captured V8 optimized-code and assembly output from jsPerf Node.js and Deno benchmark runs."
        canonical={id ? `/jit/${id}` : undefined}
        ogImage={undefined}
      />
      <Layout>
        <main className="py-8 sm:py-12">
          <div className="mb-8 overflow-hidden rounded-3xl border border-sky-500/20 bg-card/80 shadow-xl shadow-sky-500/5">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="p-6 sm:p-8">
                <div className="mb-5 inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-sm font-medium text-sky-700 dark:text-sky-300">
                  <Cpu className="mr-2 h-4 w-4 text-sky-500" />
                  V8 JIT output
                </div>
                <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                  {runtimeLabel(data)} optimized-code capture
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Review the V8 optimization trace and generated assembly captured during a jsPerf runtime comparison.
                </p>
              </div>
              <div className="border-t border-border/60 bg-slate-950 p-5 text-slate-100 lg:border-l lg:border-t-0">
                <div className="mb-4 flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ml-3 truncate font-mono text-xs text-slate-400">jit-output.txt</span>
                </div>
                <div className="space-y-3 text-sm">
                  <DarkMetric label="Runtime" value={runtimeLabel(data)} />
                  <DarkMetric label="Lines" value={formatBig(data?.meta?.lineCount || 0)} />
                  <DarkMetric label="Size" value={formatBytes(data?.meta?.sizeBytes || 0)} />
                  <DarkMetric label="Capture" value={data?.meta?.captureMode || 'v8-opt-code'} />
                </div>
              </div>
            </div>
          </div>

          {loading && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">Loading JIT output...</CardContent>
            </Card>
          )}

          {error && (
            <Card className="border-red-500/30">
              <CardContent className="p-6 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
            </Card>
          )}

          {data && (
            <Card className="overflow-hidden border-border/70 shadow-sm">
              <CardContent className="p-0">
                <div className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Captured output</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {data.meta?.truncated
                        ? 'This output hit the capture limit and was truncated.'
                        : 'Full bounded capture stored for this runtime run.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={copyOutput}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button asChild variant="outline" size="sm" className="rounded-full">
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

function DarkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold text-slate-100">{value}</div>
    </div>
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
