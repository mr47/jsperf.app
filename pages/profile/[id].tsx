import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Download, ExternalLink, Flame } from 'lucide-react'

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
        const body = await res.json().catch(() => null)
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
        <title>{title} - jsPerf</title>
      </Head>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <h1 className="text-2xl font-bold tracking-tight">CPU Profile Viewer</h1>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Node CPU profile captured from the jsPerf worker. Download the raw `.cpuprofile`
              for Chrome DevTools or CPUpro; this page shows a lightweight hot-function summary.
            </p>
          </div>

          {id && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/benchmark/cpu-profile/${id}?download=1`}>
                  <Download className="h-4 w-4" />
                  Download .cpuprofile
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/benchmark/cpu-profile/${id}/report`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open CPUpro report
                </a>
              </Button>
            </div>
          )}
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
            <Card>
              <CardContent className="grid gap-3 p-5 text-sm sm:grid-cols-4">
                <Metric label="Runtime" value={data.label || data.runtime || 'Node.js'} />
                <Metric label="Test" value={data.testIndex != null ? `#${data.testIndex + 1}` : 'Unknown'} />
                <Metric label="Samples" value={formatBig(data.meta?.sampleCount || 0)} />
                <Metric label="Size" value={formatBytes(data.meta?.sizeBytes || 0)} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold">Hot Functions</h2>
                  <p className="text-xs text-muted-foreground">
                    Self time by sampled function. Use CPUpro or DevTools for full call tree exploration.
                  </p>
                </div>

                <div className="space-y-2">
                  {hotFunctions.map((fn) => (
                    <div key={fn.key} className="grid gap-2 rounded-lg border border-border/50 p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{fn.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{fn.location || 'anonymous source'}</div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-orange-500" style={{ width: `${fn.percent}%` }} />
                        </div>
                      </div>
                      <div className="text-left text-xs tabular-nums sm:text-right">
                        <div className="font-semibold text-foreground">{fn.percent.toFixed(1)}%</div>
                        <div className="text-muted-foreground">{formatDuration(fn.selfUs)}</div>
                      </div>
                    </div>
                  ))}
                  {hotFunctions.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No sample data found in this profile.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </>
  )
}

function Metric({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold text-foreground">{value}</div>
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
