import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DatabaseZap, Search } from 'lucide-react'

import AdminShell from '../../../components/admin/AdminShell'
import {
  adminFetch, Avatar, Badge, EmptyState, ErrorNotice, formatNumber, Pager, Spinner, SuccessNotice, Table, Td, Th, timeAgo,
} from '../../../components/admin/primitives'
import { requireAdminSsr } from '../../../lib/admin'
import type { UserDoc, UserListFilter } from '../../../lib/users'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ListResponse = { items: UserDoc[]; total: number; page: number; pageSize: number }

const FILTERS: Array<{ value: UserListFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'banned', label: 'Banned' },
  { value: 'premium', label: 'Boosted' },
  { value: 'admins', label: 'Admins' },
]

function isActiveGrant(user: UserDoc) {
  return !!user.donorGrant && Date.parse(user.donorGrant.expiresAt) > Date.now()
}

function isActiveBan(user: UserDoc) {
  return !!user.ban && (!user.ban.until || Date.parse(user.ban.until) > Date.now())
}

export default function AdminUsers() {
  const router = useRouter()
  const filter = (FILTERS.some((f) => f.value === router.query.filter) ? router.query.filter : 'all') as UserListFilter
  const page = Math.max(1, Number(router.query.page) || 1)
  const q = typeof router.query.q === 'string' ? router.query.q : ''

  const [search, setSearch] = useState(q)
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { setSearch(q) }, [q])

  const load = useCallback(async () => {
    if (!router.isReady) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ filter, page: String(page) })
      if (q) params.set('q', q)
      setData(await adminFetch<ListResponse>(`/api/admin/users?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [router.isReady, filter, page, q])

  useEffect(() => { void load() }, [load])

  const navigate = (next: { filter?: string; page?: number; q?: string }) => {
    const query: Record<string, string> = {}
    const f = next.filter ?? filter
    const p = next.page ?? 1
    const s = next.q ?? q
    if (f !== 'all') query.filter = f
    if (p > 1) query.page = String(p)
    if (s) query.q = s
    void router.push({ pathname: '/admin/users', query }, undefined, { shallow: true })
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    navigate({ q: search.trim(), page: 1 })
  }

  const backfill = async () => {
    setBackfilling(true)
    setNotice(null)
    try {
      const result = await adminFetch<{ scanned: number; upserted: number }>('/api/admin/users', { method: 'POST', body: JSON.stringify({ action: 'backfill' }) })
      setNotice(`Scanned ${formatNumber(result.scanned)} authors from benchmarks, added ${formatNumber(result.upserted)} new directory entries.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed')
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <AdminShell
      title="Users"
      description="Everyone who has signed in with GitHub, plus authors backfilled from benchmark pages."
      actions={
        <Button variant="outline" size="sm" onClick={backfill} disabled={backfilling} title="Create directory entries for every githubID found on benchmark pages">
          {backfilling ? <Spinner /> : <DatabaseZap className="h-4 w-4" />} Backfill from benchmarks
        </Button>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(value) => navigate({ filter: value, page: 1 })}>
          <TabsList>
            {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <form onSubmit={submitSearch} className="flex gap-2 sm:w-96">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search login, name, email or GitHub id" aria-label="Search users" />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
      </div>

      {notice && <div className="mb-4"><SuccessNotice message={notice} /></div>}
      {error && <div className="mb-4"><ErrorNotice message={error} onRetry={load} /></div>}

      <div className="rounded-xl border bg-card px-4 py-2">
        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Spinner /> Loading users…</div>
        ) : data && data.items.length === 0 ? (
          <EmptyState>
            No users match. {data.total === 0 && filter === 'all' && !q && <>The directory fills as people sign in — or use <em>Backfill from benchmarks</em> to import historical authors.</>}
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>User</Th><Th>Email</Th><Th>Status</Th><Th className="text-right">Sign-ins</Th><Th className="text-right">Benchmarks</Th><Th>Last seen</Th></tr>
              </thead>
              <tbody>
                {data?.items.map((user) => (
                  <tr key={user.githubId} className="border-t border-border/60 hover:bg-muted/30">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar src={user.image} alt={user.login || user.githubId} />
                        <div className="min-w-0">
                          <Link href={`/admin/users/${user.githubId}`} className="font-medium">{user.login || user.name || 'unknown'}</Link>
                          <div className="truncate text-xs text-muted-foreground">{user.name && user.login ? `${user.name} · ` : ''}<span className="font-mono">{user.githubId}</span></div>
                        </div>
                      </div>
                    </Td>
                    <Td className="max-w-[220px] truncate text-muted-foreground">{user.email || '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {user.role === 'admin' && <Badge tone="info">admin</Badge>}
                        {isActiveBan(user) && <Badge tone="danger">banned{user.ban?.until ? ` · ${timeAgo(user.ban.until)}` : ''}</Badge>}
                        {isActiveGrant(user) && <Badge tone="good">boosted · {timeAgo(user.donorGrant!.expiresAt)}</Badge>}
                        {user.source === 'pages' && !user.signInCount && <Badge>never signed in</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(user.signInCount)}</Td>
                    <Td className="text-right tabular-nums">{user.pageCount != null ? formatNumber(user.pageCount) : '—'}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(user.lastSeenAt)}</Td>
                  </tr>
                ))}
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
