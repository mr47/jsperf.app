import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Activity, ArrowRight, Cpu, Download, ExternalLink, FileJson, Flame, Gauge, type LucideIcon } from 'lucide-react'

type CpuProfileNode = {
  id: number
  callFrame?: {
    functionName?: string
    url?: string
    lineNumber?: number
    columnNumber?: number
  }
}

type CpuProfileDoc = {
  id: string
  runtime?: string
  label?: string | null
  testIndex?: number
  profileLabel?: string
  meta?: {
    sizeBytes?: number
    sampleCount?: number
    nodeCount?: number
  }
  cpuProfile?: {
    nodes?: CpuProfileNode[]
    samples?: number[]
    timeDeltas?: number[]
  }
}

export default function CpuProfilePage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const [data, setData] = useState<CpuProfileDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return

    let cancelled = false
    setLoading(true)
    fetch(`/api/benchmark/cpu-profile/${id}`)
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || ''
        const body = contentType.includes('application/json')
          ? await res.json().catch(() => null)
          : { error: await formatNonJsonError(res) }
        if (!res.ok) throw new Error(body?.error || 'Failed to load CPU profile')
        return body
      })
      .then((body) => {
        if (cancelled) return
        setData(body)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Failed to load CPU profile')
        setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  const hotFunctions = useMemo(() => buildHotFunctions(data?.cpuProfile), [data?.cpuProfile])
  const title = data
    ? `${data.label || data.runtime || 'Runtime'} CPU Profile`
    : 'CPU Profile'

  return (
    <>
      <Head>
        <title>{`${title} - jsPerf`}</title>
      </Head>

      <main className="min-h-screen bg-gradient-to-b from-orange-500/5 via-background to-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
          <div className="mb-8 overflow-hidden rounded-3xl border border-orange-500/20 bg-card/80 shadow-xl shadow-orange-500/5 backdrop-blur-sm">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="mb-5 inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-sm font-medium text-orange-700 dark:text-orange-300">
                  <Flame className="mr-2 h-4 w-4 text-orange-500" />
                  CPU profile
                </div>
                <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
                  {data?.label || data?.runtime || 'Node.js'} runtime profile
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  Inspect where this benchmark burned CPU time. Open the full CPUpro report for flame graphs and call-frame tables, or download the raw `.cpuprofile` for Chrome DevTools.
                </p>

                {id && (
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <Button asChild size="lg" className="h-12 rounded-full px-6 font-bold">
                      <a href={`/api/benchmark/cpu-profile/${id}/report`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Open CPUpro report
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-6">
                      <a href={`/api/benchmark/cpu-profile/${id}?download=1`}>
                        <Download className="h-4 w-4" />
                        Download .cpuprofile
                      </a>
                    </Button>
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 bg-slate-950 p-5 text-slate-100 lg:border-l lg:border-t-0">
                <div className="mb-4 flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ml-3 truncate text-xs font-mono text-slate-400">profile.cpuprofile</span>
                </div>
                <div className="space-y-3">
                  <DarkMetric icon={Cpu} label="Runtime" value={data?.label || data?.runtime || 'Node.js'} />
                  <DarkMetric icon={Activity} label="Samples" value={formatBig(data?.meta?.sampleCount || 0)} />
                  <DarkMetric icon={Gauge} label="Nodes" value={formatBig(data?.meta?.nodeCount || 0)} />
                  <DarkMetric icon={FileJson} label="Profile size" value={formatBytes(data?.meta?.sizeBytes || 0)} />
                </div>
              </div>
            </div>
          </div>

          {loading && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading CPU profile...
              </CardContent>
            </Card>
          )}

          {error && (
            <Card className="border-red-500/30">
              <CardContent className="p-6 text-sm text-red-600 dark:text-red-400">
                {error}
              </CardContent>
            </Card>
          )}

          {data && (
            <div className="space-y-4">
              <Card className="overflow-hidden border-border/70 shadow-sm">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight">Hot functions</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Self time by sampled leaf function. Use this as a quick read before opening the full profile.
                      </p>
                    </div>
                    {id && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button asChild variant="outline" size="sm" className="rounded-full">
                          <a href={`/api/benchmark/cpu-profile/${id}?download=1`}>
                            <Download className="h-4 w-4" />
                            Raw profile
                          </a>
                        </Button>
                        <Button asChild size="sm" className="rounded-full">
                          <a href={`/api/benchmark/cpu-profile/${id}/report`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            Open CPUpro
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>

                  {hotFunctions.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="w-16 px-5 py-3 font-medium sm:px-6">#</th>
                            <th className="min-w-[260px] px-3 py-3 font-medium">Function</th>
                            <th className="min-w-[220px] px-3 py-3 font-medium">Self time</th>
                            <th className="w-28 px-5 py-3 text-right font-medium sm:px-6">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hotFunctions.map((fn, index) => (
                            <tr key={fn.key} className="border-t border-border/60 transition-colors hover:bg-muted/30">
                              <td className="px-5 py-4 text-xs font-semibold tabular-nums text-muted-foreground sm:px-6">
                                {index + 1}
                              </td>
                              <td className="px-3 py-4">
                                <div className="max-w-[520px] truncate font-medium text-foreground">{fn.name}</div>
                                <div className="mt-1 max-w-[520px] truncate text-xs text-muted-foreground">{fn.location || 'anonymous source'}</div>
                              </td>
                              <td className="px-3 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, fn.percent)}%` }} />
                                  </div>
                                  <span className="w-14 text-right text-xs font-semibold tabular-nums text-foreground">
                                    {fn.percent.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-right text-xs tabular-nums text-muted-foreground sm:px-6">
                                {formatDuration(fn.selfUs)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-5 sm:p-6">
                      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                        No sample data found in this profile.
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10">
                    <Flame className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Need the full call tree?</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      CPUpro includes packages, modules, call frames, flame graphs, and total-time drilldowns for this same profile.
                    </p>
                  </div>
                </div>
                {id && (
                  <Button asChild variant="outline" className="mt-4 rounded-full sm:mt-0">
                    <a href={`/api/benchmark/cpu-profile/${id}/report`} target="_blank" rel="noopener noreferrer">
                      Open report
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function DarkMetric({ icon: Icon, label, value }: { icon: LucideIcon, label: string, value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5 text-orange-300" />
        {label}
      </div>
      <div className="truncate text-lg font-bold text-white">{value}</div>
    </div>
  )
}

function buildHotFunctions(profile: CpuProfileDoc['cpuProfile']) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes : []
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const timeDeltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : []
  if (nodes.length === 0 || samples.length === 0) return []

  const byId = new Map(nodes.map(node => [node.id, node]))
  const totals = new Map<string, { key: string, name: string, location: string, selfUs: number }>()
  let totalUs = 0

  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i])
    if (!node) continue
    const delta = Number(timeDeltas[i]) || 0
    if (delta <= 0) continue

    const callFrame = node.callFrame || {}
    const name = callFrame.functionName || '(anonymous)'
    const location = formatLocation(callFrame)
    const key = `${name}:${location}`
    const current = totals.get(key) || { key, name, location, selfUs: 0 }
    current.selfUs += delta
    totals.set(key, current)
    totalUs += delta
  }

  return Array.from(totals.values())
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, 30)
    .map(item => ({
      ...item,
      percent: totalUs > 0 ? (item.selfUs / totalUs) * 100 : 0,
    }))
}

function formatLocation(callFrame: CpuProfileNode['callFrame'] = {}) {
  const url = callFrame.url || ''
  const shortUrl = url.split('/').filter(Boolean).slice(-2).join('/') || url
  const line = typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber + 1 : null
  return [shortUrl, line != null ? `:${line}` : null].filter(Boolean).join('')
}

function formatDuration(us: number) {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)}ms`
  return `${Math.round(us)}us`
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0B'
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

async function formatNonJsonError(res: Response) {
  const text = await res.text().catch(() => '')
  const title = text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]
  const label = title ? title.replace(/\s+/g, ' ').trim() : text.slice(0, 120)
  return `CPU profile API returned ${res.status}${label ? ` (${label})` : ''}`
}
