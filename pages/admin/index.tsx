import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, ChevronDown, FileText, RefreshCw, Users, Wrench } from 'lucide-react'

import AdminShell from '../../components/admin/AdminShell'
import {
  adminFetch, Avatar, Badge, EmptyState, formatNumber, KeyValueList, LoadingState, Notices, Section, Spinner, StatCard, StatusChip, Table, Td, Th, timeAgo, Tr,
} from '../../components/admin/primitives'
import { requireAdminSsr } from '../../lib/admin'
import type { AdminStats } from '../../lib/adminStats'
import { Button } from '@/components/ui/button'

type Props = { adminLogin: string | null }

export default function AdminDashboard({ adminLogin }: Props) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingIndexes, setCreatingIndexes] = useState(false)
  const [indexMessage, setIndexMessage] = useState<string | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setStats(await adminFetch<AdminStats>(`/api/admin/stats${fresh ? '?fresh=1' : ''}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const createIndexes = async () => {
    setCreatingIndexes(true)
    setIndexMessage(null)
    try {
      const result = await adminFetch<{ results: Array<{ collection: string; name: string; created: boolean; error?: string }> }>('/api/admin/maintenance/indexes', { method: 'POST', body: '{}' })
      const created = result.results.filter((r) => r.created)
      const failed = result.results.filter((r) => r.error)
      setIndexMessage(`${created.length} index${created.length === 1 ? '' : 'es'} created${failed.length ? `, ${failed.length} failed: ${failed.map((f) => f.error).join('; ')}` : ''}.`)
      await load(true)
    } catch (err) {
      setIndexMessage(err instanceof Error ? err.message : 'Index creation failed')
    } finally {
      setCreatingIndexes(false)
    }
  }

  const c = stats?.content
  const u = stats?.users
  const missingIndexes = stats?.indexes.filter((i) => !i.present) ?? []
  const errors24h = stats?.errors.last24h ?? []
  const errorCount24h = errors24h.reduce((sum, e) => sum + e.count, 0)
  const integrations = stats ? Object.entries(stats.system.integrations) : []
  const missingIntegrations = integrations.filter(([, ok]) => !ok).length
  const initialLoading = loading && !stats

  return (
    <AdminShell
      title="Dashboard"
      description={`Signed in as ${adminLogin || 'admin'}. Metrics are cached for one minute${stats ? `; generated ${timeAgo(stats.generatedAt)}` : ''}.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      }
    >
      <Notices error={error} onRetry={() => load()} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Benchmarks" value={formatNumber(c?.pagesTotal)} detail={`${formatNumber(c?.pages24h)} today · ${formatNumber(c?.pages7d)} this week`} icon={FileText} loading={initialLoading} />
        <StatCard label="Browser runs" value={formatNumber(c?.runsTotal)} detail={`${formatNumber(c?.runs24h)} today · ${formatNumber(c?.runs7d)} this week`} icon={BarChart3} loading={initialLoading} />
        <StatCard label="Users" value={formatNumber(u?.total)} detail={`${formatNumber(u?.active7d)} active this week · ${formatNumber(stats?.donors.activeSessions)} boosted`} icon={Users} loading={initialLoading} />
        <StatCard label="Errors · 24h" value={formatNumber(errorCount24h)} detail={`${formatNumber(stats?.errors.openGroups)} open groups`} icon={AlertTriangle} tone={errorCount24h > 0 ? 'warn' : 'good'} loading={initialLoading} />
      </div>

      {stats && (
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip label="Deep analyses" value={formatNumber(c?.analysesTotal)} tone="info" />
          <StatusChip label="Reports" value={formatNumber(c?.reportsTotal)} tone="info" />
          <StatusChip label="Banned users" value={formatNumber(u?.banned)} tone={(u?.banned ?? 0) > 0 ? 'danger' : 'neutral'} href="/admin/users?filter=banned" />
          <StatusChip label="IP bans" value={formatNumber(u?.ipBans)} tone={(u?.ipBans ?? 0) > 0 ? 'warn' : 'neutral'} href="/admin/ip-bans" />
          <StatusChip label="Indexes" value={`${stats.indexes.length - missingIndexes.length}/${stats.indexes.length}`} tone={missingIndexes.length ? 'warn' : 'good'} />
          <StatusChip label="Integrations" value={missingIntegrations ? `${missingIntegrations} missing` : 'all configured'} tone={missingIntegrations ? 'warn' : 'good'} />
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <Section title="Errors in the last 24 hours" description="Open groups by scope" flush actions={<Button asChild size="sm" variant="ghost"><Link href="/admin/errors">View all</Link></Button>}>
          {initialLoading ? <LoadingState /> : errors24h.length === 0 ? <EmptyState>No errors recorded in the last 24 hours.</EmptyState> : (
            <Table minWidth={480}>
              <thead><tr><Th>Scope</Th><Th className="text-right">Occurrences</Th><Th className="text-right">Groups</Th><Th>Last seen</Th></tr></thead>
              <tbody>
                {errors24h.map((e) => (
                  <Tr key={e.scope}>
                    <Td><Link href={`/admin/errors?scope=${encodeURIComponent(e.scope)}`} className="font-mono text-xs">{e.scope}</Link></Td>
                    <Td className="text-right tabular-nums">{formatNumber(e.count)}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(e.groups)}</Td>
                    <Td className="text-muted-foreground">{timeAgo(e.lastSeenAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Most-run benchmarks" description="Browser runs submitted in the last 7 days" flush>
          {initialLoading ? <LoadingState /> : (stats?.topBenchmarks.length ?? 0) === 0 ? <EmptyState>No runs in the last 7 days.</EmptyState> : (
            <Table minWidth={480}>
              <thead><tr><Th>Benchmark</Th><Th className="text-right">Runs</Th><Th>Last run</Th></tr></thead>
              <tbody>
                {stats?.topBenchmarks.map((b) => (
                  <Tr key={`${b.slug}-${b.revision}`}>
                    <Td>
                      <Link href={b.revision > 1 ? `/${b.slug}/${b.revision}` : `/${b.slug}`} className="line-clamp-1 font-medium">{b.title || b.slug}</Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{b.slug}</span> · v{b.revision}
                        {b.githubID && <> · <Link href={`/admin/users/${b.githubID}`}>author</Link></>}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(b.runs)}</Td>
                    <Td className="text-muted-foreground">{timeAgo(b.lastRunAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Recent sign-ins" flush actions={<Button asChild size="sm" variant="ghost"><Link href="/admin/users">All users</Link></Button>}>
          {initialLoading ? <LoadingState /> : (stats?.recentUsers.length ?? 0) === 0 ? <EmptyState>Nobody has signed in since the directory was introduced.</EmptyState> : (
            <ul className="divide-y">
              {stats?.recentUsers.map((user) => (
                <li key={user.githubId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar src={user.image} alt={user.login || user.githubId} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/users/${user.githubId}`} className="font-medium">{user.login || user.name || user.githubId}</Link>
                    <div className="truncate text-xs text-muted-foreground">{user.email || '—'} · {user.signInCount} sign-in{user.signInCount === 1 ? '' : 's'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {user.role === 'admin' && <Badge tone="info">admin</Badge>}
                    {user.ban && <Badge tone="danger">banned</Badge>}
                    {user.donorGrant && Date.parse(user.donorGrant.expiresAt) > Date.now() && <Badge tone="good">boosted</Badge>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(user.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent admin actions" flush>
          {initialLoading ? <LoadingState /> : (stats?.recentAudit.length ?? 0) === 0 ? <EmptyState>No admin actions yet.</EmptyState> : (
            <ul className="divide-y text-sm">
              {stats?.recentAudit.map((entry, i) => (
                <li key={`${entry.createdAt}-${i}`} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{entry.action}</span>
                      <span className="text-muted-foreground">{entry.targetType}</span>
                      {entry.targetType === 'user'
                        ? <Link href={`/admin/users/${entry.targetId}`} className="font-mono text-xs">{entry.targetId}</Link>
                        : <span className="font-mono text-xs text-muted-foreground">{String(entry.targetId).slice(0, 40)}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">by {entry.actorLogin || entry.actorId}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <Section
          title="System"
          description="Database indexes and the serverless instance that answered this request"
          flush
          actions={
            <>
              {missingIndexes.length > 0 && (
                <Button size="sm" onClick={createIndexes} disabled={creatingIndexes}>
                  {creatingIndexes ? <Spinner /> : <Wrench className="h-4 w-4" />} Create {missingIndexes.length} missing index{missingIndexes.length === 1 ? '' : 'es'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSystemOpen((open) => !open)} aria-expanded={systemOpen}>
                {systemOpen ? 'Hide' : 'Show'} details <ChevronDown className={`h-4 w-4 transition-transform ${systemOpen ? 'rotate-180' : ''}`} />
              </Button>
            </>
          }
        >
          {indexMessage && <p className="border-b px-5 py-3 text-sm text-muted-foreground">{indexMessage}</p>}
          {!systemOpen ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-4 text-sm text-muted-foreground">
              {stats ? (
                <>
                  <span>Node <span className="font-mono text-foreground">{stats.system.node}</span></span>
                  <span>{stats.system.env || '—'}{stats.system.region ? ` · ${stats.system.region}` : ''}</span>
                  <span>{stats.system.rssMb} MB RSS</span>
                  <span>{missingIndexes.length ? `${missingIndexes.length} index${missingIndexes.length === 1 ? '' : 'es'} missing` : 'All recommended indexes present'}</span>
                </>
              ) : 'Loading…'}
            </div>
          ) : stats ? (
            <div className="grid gap-0 lg:grid-cols-[1.3fr_0.7fr] lg:divide-x">
              <Table minWidth={520}>
                <thead><tr><Th>Collection</Th><Th>Keys</Th><Th>Purpose</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {stats.indexes.map((idx) => (
                    <Tr key={`${idx.collection}.${idx.name}`}>
                      <Td className="font-mono text-xs">{idx.collection}</Td>
                      <Td className="font-mono text-xs">{Object.entries(idx.keys).map(([k, v]) => `${k}:${v}`).join(', ')}</Td>
                      <Td className="text-xs text-muted-foreground">{idx.reason}</Td>
                      <Td>{idx.present ? <Badge tone="good">present</Badge> : <Badge tone="warn">missing</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t p-5 lg:border-t-0">
                <KeyValueList items={[
                  { label: 'Node', value: <span className="font-mono text-xs">{stats.system.node}</span> },
                  { label: 'Environment', value: `${stats.system.env || '—'}${stats.system.region ? ` · ${stats.system.region}` : ''}` },
                  { label: 'Uptime', value: `${formatNumber(stats.system.uptimeSeconds)}s` },
                  { label: 'Memory', value: `${stats.system.rssMb} MB RSS · ${stats.system.heapUsedMb} MB heap` },
                ]} />
                <h3 className="mb-2 mt-5 text-xs font-medium text-muted-foreground">Integrations</h3>
                <ul className="space-y-1.5">
                  {integrations.map(([key, ok]) => (
                    <li key={key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-mono text-xs">{key}</span>
                      {ok ? <Badge tone="good">configured</Badge> : <Badge tone="warn">missing</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : <LoadingState />}
        </Section>
      </div>
    </AdminShell>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const guard = await requireAdminSsr(ctx)
  if ('redirect' in guard) return { redirect: guard.redirect }
  if ('notFound' in guard) return { notFound: true }
  return { props: { adminLogin: guard.admin.login } }
}
