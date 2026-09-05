import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, Database, FileText, Microscope, RefreshCw, ShieldBan, Sparkles, Users, Wrench } from 'lucide-react'

import AdminShell from '../../components/admin/AdminShell'
import {
  adminFetch, Avatar, Badge, EmptyState, ErrorNotice, formatNumber, Section, Spinner, StatCard, Table, Td, Th, timeAgo,
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

  return (
    <AdminShell
      title="Dashboard"
      description={`Signed in as ${adminLogin || 'admin'}. Metrics are cached for one minute.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      }
    >
      {error && <div className="mb-4"><ErrorNotice message={error} onRetry={() => load()} /></div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Benchmarks" value={formatNumber(c?.pagesTotal)} detail={`${formatNumber(c?.pages24h)} today · ${formatNumber(c?.pages7d)} this week`} icon={FileText} loading={loading && !stats} />
        <StatCard label="Browser runs" value={formatNumber(c?.runsTotal)} detail={`${formatNumber(c?.runs24h)} today · ${formatNumber(c?.runs7d)} this week`} icon={BarChart3} loading={loading && !stats} />
        <StatCard label="Deep analyses" value={formatNumber(c?.analysesTotal)} detail={`${formatNumber(c?.multiRuntimeTotal)} multi-runtime · ${formatNumber(c?.reportsTotal)} reports`} icon={Microscope} loading={loading && !stats} />
        <StatCard label="Open errors" value={formatNumber(stats?.errors.openGroups)} detail={`${formatNumber(errorCount24h)} occurrences in 24h`} icon={AlertTriangle} tone={errorCount24h > 0 ? 'warn' : 'good'} loading={loading && !stats} />
        <StatCard label="Users" value={formatNumber(u?.total)} detail={`${formatNumber(u?.active7d)} signed in this week · ${formatNumber(u?.admins)} admins`} icon={Users} loading={loading && !stats} />
        <StatCard label="Banned" value={formatNumber(u?.banned)} detail={`${formatNumber(u?.ipBans)} IP bans`} icon={ShieldBan} tone={(u?.banned ?? 0) > 0 ? 'danger' : 'default'} loading={loading && !stats} />
        <StatCard label="Boosted" value={formatNumber(stats?.donors.activeSessions)} detail={`${formatNumber(u?.granted)} admin grants · ${formatNumber(stats?.donors.emailMatches)} email matches${stats && !stats.donors.activeSessionsComplete ? ' (partial scan)' : ''}`} icon={Sparkles} loading={loading && !stats} />
        <StatCard label="Indexes" value={stats ? `${stats.indexes.length - missingIndexes.length}/${stats.indexes.length}` : '—'} detail={missingIndexes.length ? `${missingIndexes.length} recommended index${missingIndexes.length === 1 ? '' : 'es'} missing` : 'All recommended indexes present'} icon={Database} tone={missingIndexes.length ? 'warn' : 'good'} loading={loading && !stats} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Errors in the last 24h" description="Open error groups by scope" actions={<Button asChild size="sm" variant="ghost"><Link href="/admin/errors">View all</Link></Button>}>
          {stats && errors24h.length === 0 ? <EmptyState>No errors recorded in the last 24 hours.</EmptyState> : (
            <Table>
              <thead><tr><Th>Scope</Th><Th className="text-right">Occurrences</Th><Th className="text-right">Groups</Th><Th>Last seen</Th></tr></thead>
              <tbody>
                {errors24h.map((e) => (
                  <tr key={e.scope} className="border-t border-border/60">
                    <Td><Link href={`/admin/errors?scope=${encodeURIComponent(e.scope)}`} className="font-mono text-xs">{e.scope}</Link></Td>
                    <Td className="text-right tabular-nums">{formatNumber(e.count)}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(e.groups)}</Td>
                    <Td className="text-muted-foreground">{timeAgo(e.lastSeenAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Most-run benchmarks" description="By browser runs submitted in the last 7 days">
          {stats && stats.topBenchmarks.length === 0 ? <EmptyState>No runs in the last 7 days.</EmptyState> : (
            <Table>
              <thead><tr><Th>Benchmark</Th><Th className="text-right">Runs</Th><Th>Last run</Th></tr></thead>
              <tbody>
                {stats?.topBenchmarks.map((b) => (
                  <tr key={`${b.slug}-${b.revision}`} className="border-t border-border/60">
                    <Td>
                      <Link href={b.revision > 1 ? `/${b.slug}/${b.revision}` : `/${b.slug}`} className="line-clamp-1">{b.title || b.slug}</Link>
                      <div className="text-xs text-muted-foreground">{b.slug} · v{b.revision}{b.githubID && <> · <Link href={`/admin/users/${b.githubID}`}>author</Link></>}</div>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(b.runs)}</Td>
                    <Td className="text-muted-foreground">{timeAgo(b.lastRunAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Recent sign-ins" actions={<Button asChild size="sm" variant="ghost"><Link href="/admin/users">All users</Link></Button>}>
          {stats && stats.recentUsers.length === 0 ? <EmptyState>Nobody has signed in since the directory was introduced.</EmptyState> : (
            <ul className="divide-y divide-border/60">
              {stats?.recentUsers.map((user) => (
                <li key={user.githubId} className="flex items-center gap-3 py-2">
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
                  <span className="text-xs text-muted-foreground">{timeAgo(user.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent admin actions">
          {stats && stats.recentAudit.length === 0 ? <EmptyState>No admin actions yet.</EmptyState> : (
            <ul className="divide-y divide-border/60 text-sm">
              {stats?.recentAudit.map((entry, i) => (
                <li key={`${entry.createdAt}-${i}`} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <span className="font-mono text-xs">{entry.action}</span>
                    <span className="text-muted-foreground"> · {entry.targetType} </span>
                    {entry.targetType === 'user' ? <Link href={`/admin/users/${entry.targetId}`} className="font-mono text-xs">{entry.targetId}</Link> : <span className="font-mono text-xs">{String(entry.targetId).slice(0, 40)}</span>}
                    <div className="text-xs text-muted-foreground">by {entry.actorLogin || entry.actorId}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Section
          title="Database indexes"
          description="Indexes the hot read paths depend on. Missing ones cause collection scans."
          actions={missingIndexes.length > 0 && (
            <Button size="sm" onClick={createIndexes} disabled={creatingIndexes}>
              {creatingIndexes ? <Spinner /> : <Wrench className="h-4 w-4" />} Create missing
            </Button>
          )}
        >
          {indexMessage && <p className="mb-3 text-sm text-muted-foreground">{indexMessage}</p>}
          {stats ? (
            <Table>
              <thead><tr><Th>Collection</Th><Th>Keys</Th><Th>Why</Th><Th>Status</Th></tr></thead>
              <tbody>
                {stats.indexes.map((idx) => (
                  <tr key={`${idx.collection}.${idx.name}`} className="border-t border-border/60">
                    <Td className="font-mono text-xs">{idx.collection}</Td>
                    <Td className="font-mono text-xs">{Object.entries(idx.keys).map(([k, v]) => `${k}:${v}`).join(', ')}</Td>
                    <Td className="text-xs text-muted-foreground">{idx.reason}</Td>
                    <Td>{idx.present ? <Badge tone="good">present</Badge> : <Badge tone="warn">missing</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState>Loading…</EmptyState>}
        </Section>

        <Section title="System" description="Serverless instance that answered this request">
          {stats ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Node</dt><dd className="font-mono text-xs">{stats.system.node}</dd>
              <dt className="text-muted-foreground">Environment</dt><dd>{stats.system.env || '—'}{stats.system.region ? ` · ${stats.system.region}` : ''}</dd>
              <dt className="text-muted-foreground">Uptime</dt><dd>{formatNumber(stats.system.uptimeSeconds)}s</dd>
              <dt className="text-muted-foreground">Memory</dt><dd>{stats.system.rssMb} MB RSS · {stats.system.heapUsedMb} MB heap</dd>
              <dt className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Integrations</dt>
              {Object.entries(stats.system.integrations).map(([key, ok]) => (
                <div key={key} className="col-span-2 flex items-center justify-between">
                  <span className="font-mono text-xs">{key}</span>
                  {ok ? <Badge tone="good">configured</Badge> : <Badge tone="warn">missing</Badge>}
                </div>
              ))}
              <dt className="col-span-2 mt-2 text-xs text-muted-foreground"><Activity className="mr-1 inline h-3 w-3" />Generated {timeAgo(stats.generatedAt)}</dt>
            </dl>
          ) : <EmptyState>Loading…</EmptyState>}
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
