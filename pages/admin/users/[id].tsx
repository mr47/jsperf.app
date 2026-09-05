import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, Ban, ExternalLink, ShieldCheck, ShieldOff, Sparkles, Undo2 } from 'lucide-react'

import AdminShell from '../../../components/admin/AdminShell'
import {
  adminFetch, Avatar, Badge, EmptyState, ErrorNotice, formatDateTime, formatNumber, Section, Spinner, SuccessNotice, Table, Td, Th, timeAgo,
} from '../../../components/admin/primitives'
import { requireAdminSsr } from '../../../lib/admin'
import { normalizeGithubId, type UserDoc } from '../../../lib/users'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Benchmark = { slug: string; title: string; revision: number; revisionCount: number; published: string; visible: boolean; testsCount: number }
type AuditRow = { action: string; actorLogin: string | null; actorId: string; details: Record<string, unknown>; createdAt: string }
type Detail = { user: (UserDoc & { isEnvAdmin?: boolean }) | null; benchmarks: Benchmark[]; audit: AuditRow[] }

type Props = { id: string; selfId: string }

export default function AdminUserDetail({ id, selfId }: Props) {
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [banReason, setBanReason] = useState('')
  const [banDays, setBanDays] = useState('')
  const [hideContent, setHideContent] = useState(false)

  const [grantDays, setGrantDays] = useState('30')
  const [grantTier, setGrantTier] = useState('Admin grant')
  const [grantNote, setGrantNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch<Detail>(`/api/admin/users/${id}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      setNotice(await fn())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const user = data?.user
  const isSelf = id === selfId
  const activeBan = user?.ban && (!user.ban.until || Date.parse(user.ban.until) > Date.now()) ? user.ban : null
  const activeGrant = user?.donorGrant && Date.parse(user.donorGrant.expiresAt) > Date.now() ? user.donorGrant : null
  const displayName = user?.login || user?.name || id

  const submitBan = (event: FormEvent) => {
    event.preventDefault()
    if (!banReason.trim()) { setError('A ban reason is required.'); return }
    if (!window.confirm(`Ban ${displayName}?${hideContent ? ' Their benchmarks will be unpublished.' : ''}`)) return
    void run('ban', async () => {
      const result = await adminFetch<{ hiddenPages: number; revalidated: number }>(`/api/admin/users/${id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: banReason.trim(), days: Number(banDays) || 0, hideContent }),
      })
      setBanReason(''); setBanDays(''); setHideContent(false)
      return `User banned.${result.hiddenPages ? ` ${result.hiddenPages} benchmark${result.hiddenPages === 1 ? '' : 's'} hidden (${result.revalidated} pages revalidated).` : ''}`
    })
  }

  const unban = () => {
    if (!window.confirm(`Lift the ban on ${displayName}?`)) return
    void run('unban', async () => {
      const result = await adminFetch<{ restoredPages: number }>(`/api/admin/users/${id}/ban`, { method: 'DELETE' })
      return `Ban lifted.${result.restoredPages ? ` ${result.restoredPages} benchmark${result.restoredPages === 1 ? '' : 's'} restored.` : ''}`
    })
  }

  const submitGrant = (event: FormEvent) => {
    event.preventDefault()
    void run('grant', async () => {
      await adminFetch(`/api/admin/users/${id}/premium`, {
        method: 'POST',
        body: JSON.stringify({ days: Number(grantDays), tierName: grantTier, note: grantNote }),
      })
      setGrantNote('')
      return `Donor boost granted for ${grantDays} day${grantDays === '1' ? '' : 's'}.`
    })
  }

  const revokeGrant = () => {
    if (!window.confirm(`Revoke the donor boost for ${displayName}?`)) return
    void run('revoke', async () => {
      await adminFetch(`/api/admin/users/${id}/premium`, { method: 'DELETE' })
      return 'Donor boost revoked.'
    })
  }

  const setRole = (role: 'admin' | null) => {
    if (!window.confirm(role ? `Make ${displayName} an admin?` : `Remove admin role from ${displayName}?`)) return
    void run('role', async () => {
      await adminFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
      return role ? 'Admin role granted.' : 'Admin role removed.'
    })
  }

  return (
    <AdminShell
      title={displayName}
      description={user ? `GitHub id ${user.githubId}${user.email ? ` · ${user.email}` : ''}` : `GitHub id ${id}`}
      actions={
        <>
          <Button asChild variant="ghost" size="sm"><Link href="/admin/users"><ArrowLeft className="h-4 w-4" /> Users</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/u/${id}`}><ExternalLink className="h-4 w-4" /> Public profile</Link></Button>
          {user?.login && <Button asChild variant="outline" size="sm"><a href={`https://github.com/${user.login}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> GitHub</a></Button>}
        </>
      }
    >
      {notice && <div className="mb-4"><SuccessNotice message={notice} /></div>}
      {error && <div className="mb-4"><ErrorNotice message={error} onRetry={load} /></div>}

      {loading && !data ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Spinner /> Loading…</div>
      ) : !user ? (
        <EmptyState>
          This GitHub id has no directory entry yet (they have not signed in since the admin panel was added).
          {data?.benchmarks.length ? ` They authored ${data.benchmarks.length} benchmark${data.benchmarks.length === 1 ? '' : 's'} listed below; a ban can still be applied by id.` : ''}
        </EmptyState>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Section title="Profile">
          <div className="flex items-start gap-4">
            <Avatar src={user?.image} alt={displayName} size={56} />
            <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Login</dt><dd>{user?.login || '—'}</dd>
              <dt className="text-muted-foreground">Name</dt><dd>{user?.name || '—'}</dd>
              <dt className="text-muted-foreground">Emails</dt><dd className="break-all">{[user?.email, ...(user?.emails || [])].filter((e, i, arr) => e && arr.indexOf(e) === i).join(', ') || '—'}</dd>
              <dt className="text-muted-foreground">First seen</dt><dd>{formatDateTime(user?.firstSeenAt)}</dd>
              <dt className="text-muted-foreground">Last seen</dt><dd>{formatDateTime(user?.lastSeenAt)} <span className="text-muted-foreground">({timeAgo(user?.lastSeenAt)})</span></dd>
              <dt className="text-muted-foreground">Sign-ins</dt><dd>{formatNumber(user?.signInCount ?? 0)}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex flex-wrap gap-1">
                {user?.role === 'admin' && <Badge tone="info">admin</Badge>}
                {user?.isEnvAdmin && <Badge tone="info">env admin</Badge>}
                {activeBan && <Badge tone="danger">banned</Badge>}
                {activeGrant && <Badge tone="good">boosted</Badge>}
                {!activeBan && !activeGrant && user?.role !== 'admin' && !user?.isEnvAdmin && <Badge>regular</Badge>}
              </dd>
            </dl>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {user?.role === 'admin' ? (
              <Button size="sm" variant="outline" disabled={isSelf || busy !== null} onClick={() => setRole(null)} title={isSelf ? 'You cannot demote yourself' : undefined}>
                {busy === 'role' ? <Spinner /> : <ShieldOff className="h-4 w-4" />} Remove admin role
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={!user || busy !== null} onClick={() => setRole('admin')}>
                {busy === 'role' ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Make admin
              </Button>
            )}
            {user?.isEnvAdmin && <span className="self-center text-xs text-muted-foreground">Listed in the env allowlist; cannot be demoted from here.</span>}
          </div>
        </Section>

        <Section title="Donor boost" description="Premium perks without a donation. Applies to rate limits, reports and worker-side analysis.">
          {activeGrant ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-emerald-600" /> {activeGrant.tierName}</div>
                <div className="mt-1 text-muted-foreground">Expires {formatDateTime(activeGrant.expiresAt)} ({timeAgo(activeGrant.expiresAt)})</div>
                <div className="text-muted-foreground">Granted {timeAgo(activeGrant.grantedAt)} by {activeGrant.grantedBy}{activeGrant.note ? ` — ${activeGrant.note}` : ''}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={revokeGrant}>{busy === 'revoke' ? <Spinner /> : <Undo2 className="h-4 w-4" />} Revoke</Button>
              </div>
              <p className="text-xs text-muted-foreground">Submitting the form below replaces the current grant.</p>
            </div>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">{user?.donorGrant ? `Previous grant expired ${timeAgo(user.donorGrant.expiresAt)}.` : 'No active grant.'}</p>
          )}
          <form onSubmit={submitGrant} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="grant-days">Duration (days)</Label>
              <Input id="grant-days" type="number" min={1} max={3650} value={grantDays} onChange={(e) => setGrantDays(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-tier">Tier label</Label>
              <Input id="grant-tier" value={grantTier} onChange={(e) => setGrantTier(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="grant-note">Note (internal)</Label>
              <Input id="grant-note" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} maxLength={500} placeholder="Why this user gets a boost" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={!user || busy !== null} title={!user ? 'User must sign in once first' : undefined}>
                {busy === 'grant' ? <Spinner /> : <Sparkles className="h-4 w-4" />} {activeGrant ? 'Replace grant' : 'Grant boost'}
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Ban" description="Blocks sign-in, benchmark create/edit, run submission, deep analysis and reports. Public pages stay readable." className="lg:col-span-2">
          {activeBan ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive"><Ban className="h-4 w-4" /> Banned {activeBan.until ? `until ${formatDateTime(activeBan.until)}` : 'permanently'}</div>
                <div className="mt-1">{activeBan.reason}</div>
                <div className="mt-1 text-muted-foreground">By {activeBan.by}, {timeAgo(activeBan.at)}{activeBan.hiddenPageIds?.length ? ` · ${activeBan.hiddenPageIds.length} benchmark${activeBan.hiddenPageIds.length === 1 ? '' : 's'} hidden` : ''}</div>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={unban}>{busy === 'unban' ? <Spinner /> : <Undo2 className="h-4 w-4" />} Lift ban</Button>
            </div>
          ) : (
            <form onSubmit={submitBan} className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="ban-reason">Reason</Label>
                <Input id="ban-reason" value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={500} placeholder="Spam benchmarks, abuse, …" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ban-days">Duration (days, blank = permanent)</Label>
                <Input id="ban-days" type="number" min={1} max={3650} value={banDays} onChange={(e) => setBanDays(e.target.value)} placeholder="∞" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={hideContent} onChange={(e) => setHideContent(e.target.checked)} className="h-4 w-4 rounded border-input" />
                Also unpublish all their benchmarks (restored automatically when the ban is lifted)
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" variant="destructive" disabled={isSelf || busy !== null} title={isSelf ? 'You cannot ban yourself' : undefined}>
                  {busy === 'ban' ? <Spinner /> : <Ban className="h-4 w-4" />} Ban user
                </Button>
              </div>
            </form>
          )}
        </Section>

        <Section title={`Benchmarks${data ? ` (${data.benchmarks.length}${data.benchmarks.length >= 50 ? '+' : ''})`: ''}`} className="lg:col-span-2">
          {data && data.benchmarks.length === 0 ? <EmptyState>No benchmarks authored while signed in.</EmptyState> : (
            <Table>
              <thead><tr><Th>Title</Th><Th>Slug</Th><Th className="text-right">Revisions</Th><Th className="text-right">Tests</Th><Th>Visibility</Th><Th>Published</Th></tr></thead>
              <tbody>
                {data?.benchmarks.map((b) => (
                  <tr key={b.slug} className="border-t border-border/60">
                    <Td><Link href={b.revision > 1 ? `/${b.slug}/${b.revision}` : `/${b.slug}`} className="line-clamp-1">{b.title || 'Untitled'}</Link></Td>
                    <Td className="font-mono text-xs">{b.slug}</Td>
                    <Td className="text-right tabular-nums">{b.revisionCount}</Td>
                    <Td className="text-right tabular-nums">{b.testsCount}</Td>
                    <Td>{b.visible ? <Badge tone="good">public</Badge> : <Badge>hidden</Badge>}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(b.published)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Moderation history" className="lg:col-span-2">
          {data && data.audit.length === 0 ? <EmptyState>No admin actions recorded for this user.</EmptyState> : (
            <ul className="divide-y divide-border/60 text-sm">
              {data?.audit.map((entry, i) => (
                <li key={`${entry.createdAt}-${i}`} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <span className="font-mono text-xs">{entry.action}</span>
                    <span className="text-muted-foreground"> by {entry.actorLogin || entry.actorId}</span>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{JSON.stringify(entry.details)}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AdminShell>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const guard = await requireAdminSsr(ctx)
  if ('redirect' in guard) return { redirect: guard.redirect }
  if ('notFound' in guard) return { notFound: true }
  const id = normalizeGithubId(ctx.params?.id)
  if (!id) return { notFound: true }
  return { props: { id, selfId: guard.admin.id } }
}
