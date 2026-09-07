import type { GetServerSideProps } from 'next'
import { useRouter } from 'next/router'
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronRight, RefreshCw, Search, Trash2, Undo2 } from 'lucide-react'

import AdminShell from '../../components/admin/AdminShell'
import {
  adminFetch, Badge, EmptyState, ErrorNotice, formatDateTime, formatNumber, Pager, Spinner, SuccessNotice, Table, Td, Th, timeAgo,
} from '../../components/admin/primitives'
import { requireAdminSsr } from '../../lib/admin'
import type { ErrorDoc } from '../../lib/errorLog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Row = Omit<ErrorDoc, 'firstSeenAt' | 'lastSeenAt' | 'resolvedAt'> & { _id: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null }
type ListResponse = { items: Row[]; total: number; page: number; pageSize: number; scopes: string[] }
type Status = 'open' | 'resolved' | 'all'

export default function AdminErrors() {
  const router = useRouter()
  const status = (['open', 'resolved', 'all'].includes(String(router.query.status)) ? router.query.status : 'open') as Status
  const scope = typeof router.query.scope === 'string' ? router.query.scope : ''
  const source = router.query.source === 'client' || router.query.source === 'server' ? router.query.source : ''
  const q = typeof router.query.q === 'string' ? router.query.q : ''
  const page = Math.max(1, Number(router.query.page) || 1)

  const [search, setSearch] = useState(q)
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => { setSearch(q) }, [q])

  const load = useCallback(async () => {
    if (!router.isReady) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ status, page: String(page) })
      if (scope) params.set('scope', scope)
      if (source) params.set('source', source)
      if (q) params.set('q', q)
      const result = await adminFetch<ListResponse>(`/api/admin/errors?${params}`)
      setData(result)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load errors')
    } finally {
      setLoading(false)
    }
  }, [router.isReady, status, scope, source, q, page])

  useEffect(() => { void load() }, [load])

  const navigate = (next: Partial<{ status: string; scope: string; source: string; q: string; page: number }>) => {
    const merged = { status, scope, source, q, page: 1, ...next }
    const query: Record<string, string> = {}
    if (merged.status !== 'open') query.status = merged.status
    if (merged.scope) query.scope = merged.scope
    if (merged.source) query.source = merged.source
    if (merged.q) query.q = merged.q
    if (merged.page > 1) query.page = String(merged.page)
    void router.push({ pathname: '/admin/errors', query }, undefined, { shallow: true })
  }

  const toggleExpanded = (id: string) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleSelected = (id: string) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const allSelected = !!data && data.items.length > 0 && data.items.every((r) => selected.has(r._id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(data?.items.map((r) => r._id) || []))

  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await fn())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const resolveSelected = (resolved: boolean) => act(async () => {
    const result = await adminFetch<{ modified: number }>('/api/admin/errors', { method: 'PATCH', body: JSON.stringify({ ids: Array.from(selected), resolved }) })
    return `${result.modified} group${result.modified === 1 ? '' : 's'} ${resolved ? 'resolved' : 'reopened'}.`
  })

  const deleteSelected = () => {
    if (!window.confirm(`Delete ${selected.size} error group${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    void act(async () => {
      const result = await adminFetch<{ deleted: number }>(`/api/admin/errors?ids=${Array.from(selected).join(',')}`, { method: 'DELETE' })
      return `${result.deleted} group${result.deleted === 1 ? '' : 's'} deleted.`
    })
  }

  const purgeResolved = () => {
    if (!window.confirm('Delete every resolved error group?')) return
    void act(async () => {
      const result = await adminFetch<{ deleted: number }>('/api/admin/errors?resolvedOnly=1', { method: 'DELETE' })
      return `${result.deleted} resolved group${result.deleted === 1 ? '' : 's'} deleted.`
    })
  }

  const submitSearch = (event: FormEvent) => { event.preventDefault(); navigate({ q: search.trim() }) }

  return (
    <AdminShell
      title="Errors"
      description="Server and browser errors grouped by fingerprint and hour. Entries expire automatically after 30 days."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh</Button>
          <Button variant="outline" size="sm" onClick={purgeResolved} disabled={busy}><Trash2 className="h-4 w-4" /> Purge resolved</Button>
        </>
      }
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={status} onValueChange={(value) => navigate({ status: value })}>
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={source || 'any'} onValueChange={(value) => navigate({ source: value === 'any' ? '' : value })}>
            <TabsList>
              <TabsTrigger value="any">Any source</TabsTrigger>
              <TabsTrigger value="server">Server</TabsTrigger>
              <TabsTrigger value="client">Browser</TabsTrigger>
            </TabsList>
          </Tabs>
          <select
            value={scope}
            onChange={(e) => navigate({ scope: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30"
            aria-label="Filter by scope"
          >
            <option value="">All scopes</option>
            {(data?.scopes || (scope ? [scope] : [])).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <form onSubmit={submitSearch} className="flex gap-2 lg:w-80">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search message" aria-label="Search error messages" />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
      </div>

      {notice && <div className="mb-4"><SuccessNotice message={notice} /></div>}
      {error && <div className="mb-4"><ErrorNotice message={error} onRetry={load} /></div>}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {status !== 'resolved' && <Button size="sm" variant="outline" disabled={busy} onClick={() => resolveSelected(true)}><Check className="h-4 w-4" /> Resolve</Button>}
          {status !== 'open' && <Button size="sm" variant="outline" disabled={busy} onClick={() => resolveSelected(false)}><Undo2 className="h-4 w-4" /> Reopen</Button>}
          <Button size="sm" variant="destructive" disabled={busy} onClick={deleteSelected}><Trash2 className="h-4 w-4" /> Delete</Button>
        </div>
      )}

      <div className="rounded-xl border bg-card px-4 py-2">
        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Spinner /> Loading errors…</div>
        ) : data && data.items.length === 0 ? (
          <EmptyState>{status === 'open' && !scope && !q ? 'No open errors. Nice.' : 'Nothing matches these filters.'}</EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="h-4 w-4" /></Th>
                  <Th className="w-8" />
                  <Th>Error</Th>
                  <Th>Scope</Th>
                  <Th className="text-right">Count</Th>
                  <Th>Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => {
                  const open = expanded.has(row._id)
                  return (
                    <Fragment key={row._id}>
                      <tr className="border-t border-border/60 hover:bg-muted/30">
                        <Td><input type="checkbox" checked={selected.has(row._id)} onChange={() => toggleSelected(row._id)} aria-label="Select error" className="h-4 w-4" /></Td>
                        <Td>
                          <button type="button" onClick={() => toggleExpanded(row._id)} className="text-muted-foreground hover:text-foreground" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}>
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </Td>
                        <Td>
                          <button type="button" onClick={() => toggleExpanded(row._id)} className="text-left">
                            <div className="line-clamp-2 font-mono text-xs">{row.message}</div>
                          </button>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone={row.source === 'client' ? 'info' : 'neutral'}>{row.source}</Badge>
                            {row.level === 'warn' && <Badge tone="warn">warn</Badge>}
                            {row.resolvedAt && <Badge tone="good">resolved {timeAgo(row.resolvedAt)}</Badge>}
                            <span className="text-[11px] text-muted-foreground">bucket {row.bucket}</span>
                          </div>
                        </Td>
                        <Td><button type="button" onClick={() => navigate({ scope: row.scope })} className="font-mono text-xs hover:underline">{row.scope}</button></Td>
                        <Td className="text-right tabular-nums">{formatNumber(row.count)}</Td>
                        <Td className="whitespace-nowrap text-muted-foreground" title={formatDateTime(row.lastSeenAt)}>{timeAgo(row.lastSeenAt)}</Td>
                      </tr>
                      {open && (
                        <tr className="border-t border-border/40 bg-muted/20">
                          <Td className="p-0" />
                          <Td className="p-0" />
                          <td colSpan={4} className="px-4 py-3">
                            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                              <div>
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Stack</div>
                                <pre className="max-h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-5">{row.stack || row.message}</pre>
                              </div>
                              <div>
                                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recent samples ({row.samples?.length || 0})</div>
                                <div className="space-y-2">
                                  {(row.samples || []).slice().reverse().map((sample, i) => (
                                    <pre key={i} className="overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] leading-5">{JSON.stringify(sample, null, 1)}</pre>
                                  ))}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">First seen {formatDateTime(row.firstSeenAt)} · fingerprint <span className="font-mono">{row.fingerprint}</span></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </Table>
            {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => navigate({ page: p })} />}
          </>
        )}
      </div>
    </AdminShell>
  )
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const guard = await requireAdminSsr(ctx)
  if ('redirect' in guard) return { redirect: guard.redirect }
  if ('notFound' in guard) return { notFound: true }
  return { props: {} }
}
