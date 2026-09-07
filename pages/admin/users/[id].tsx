import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Ban, ExternalLink, ShieldCheck, ShieldOff, Sparkles, Undo2 } from 'lucide-react'

import AdminShell from '../../../components/admin/AdminShell'
import {
  adminFetch, Avatar, Badge, ConfirmDialog, EmptyState, FormDialog, formatDateTime, formatNumber, KeyValueList, LoadingState, Notices, Section, Table, Td, Th, timeAgo, Tr,
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

type DialogKind = 'ban' | 'unban' | 'grant' | 'revoke' | 'promote' | 'demote' | null

export default function AdminUserDetail({ id, selfId }: Props) {
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)

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

  /** Runs a mutation; errors are rethrown so dialogs can show them inline. */
  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const message = await fn()
      setDialog(null)
      setNotice(message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  /** Same as `run`, for confirm dialogs that have no inline error slot. */
  const runOrReport = (fn: () => Promise<string>) => run(fn).catch((err) => {
    setDialog(null)
    setError(err instanceof Error ? err.message : 'Action failed')
  })

  const user = data?.user
  const isSelf = id === selfId
  const activeBan = user?.ban && (!user.ban.until || Date.parse(user.ban.until) > Date.now()) ? user.ban : null
  const activeGrant = user?.donorGrant && Date.parse(user.donorGrant.expiresAt) > Date.now() ? user.donorGrant : null
  const displayName = user?.login || user?.name || id
  const emails = [user?.email, ...(user?.emails || [])].filter((e, i, arr): e is string => !!e && arr.indexOf(e) === i)

  const submitBan = () => run(async () => {
    if (!banReason.trim()) throw new Error('A ban reason is required.')
    const result = await adminFetch<{ hiddenPages: number; revalidated: number }>(`/api/admin/users/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason: banReason.trim(), days: Number(banDays) || 0, hideContent }),
    })
    setBanReason(''); setBanDays(''); setHideContent(false)
    return `User banned.${result.hiddenPages ? ` ${result.hiddenPages} benchmark${result.hiddenPages === 1 ? '' : 's'} hidden (${result.revalidated} pages revalidated).` : ''}`
  })

  const unban = () => runOrReport(async () => {
    const result = await adminFetch<{ restoredPages: number }>(`/api/admin/users/${id}/ban`, { method: 'DELETE' })
    return `Ban lifted.${result.restoredPages ? ` ${result.restoredPages} benchmark${result.restoredPages === 1 ? '' : 's'} restored.` : ''}`
  })

  const submitGrant = () => run(async () => {
    const days = Number(grantDays)
    if (!Number.isFinite(days) || days < 1) throw new Error('Duration must be at least one day.')
    await adminFetch(`/api/admin/users/${id}/premium`, {
      method: 'POST',
      body: JSON.stringify({ days, tierName: grantTier, note: grantNote }),
    })
    setGrantNote('')
    return `Donor boost granted for ${days} day${days === 1 ? '' : 's'}.`
  })

  const revokeGrant = () => runOrReport(async () => {
    await adminFetch(`/api/admin/users/${id}/premium`, { method: 'DELETE' })
    return 'Donor boost revoked.'
  })

  const setRole = (role: 'admin' | null) => runOrReport(async () => {
    await adminFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
    return role ? 'Admin role granted.' : 'Admin role removed.'
  })

  return (
    <AdminShell
      title={displayName}
      description={user ? `GitHub id ${user.githubId}${user.email ? ` · ${user.email}` : ''}` : `GitHub id ${id}`}
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Users', href: '/admin/users' }, { label: displayName }]}
      actions={
        <>
          <Button asChild variant="outline" size="sm"><Link href={`/u/${id}`}><ExternalLink className="h-4 w-4" /> Public profile</Link></Button>
          {user?.login && <Button asChild variant="outline" size="sm"><a href={`https://github.com/${user.login}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> GitHub</a></Button>}
        </>
      }
    >
      <Notices notice={notice} error={error} onRetry={load} />

      {loading && !data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Profile + actions */}
          <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-4">
                <Avatar src={user?.image} alt={displayName} size={56} />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{user?.name && user.login ? `${user.name} · ` : ''}<span className="font-mono">{id}</span></div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1">
                {user?.role === 'admin' && <Badge tone="info">admin</Badge>}
                {user?.isEnvAdmin && <Badge tone="info">env admin</Badge>}
                {activeBan && <Badge tone="danger">banned</Badge>}
                {activeGrant && <Badge tone="good">boosted</Badge>}
                {user && !activeBan && !activeGrant && user.role !== 'admin' && !user.isEnvAdmin && <Badge>regular</Badge>}
                {!user && <Badge tone="warn">no directory entry</Badge>}
              </div>

              {user ? (
                <KeyValueList
                  className="mt-5"
                  items={[
                    { label: 'Emails', value: emails.length ? emails.join(', ') : '—' },
                    { label: 'First seen', value: formatDateTime(user.firstSeenAt) },
                    { label: 'Last seen', value: <>{timeAgo(user.lastSeenAt)} <span className="text-muted-foreground">({formatDateTime(user.lastSeenAt)})</span></> },
                    { label: 'Sign-ins', value: formatNumber(user.signInCount ?? 0) },
                  ]}
                />
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  This GitHub id has not signed in since the admin panel was added.
                  {data?.benchmarks.length ? ` They authored ${data.benchmarks.length} benchmark${data.benchmarks.length === 1 ? '' : 's'}; a ban can still be applied by id.` : ''}
                </p>
              )}
            </div>

            <div className="rounded-xl border bg-card p-2 shadow-sm">
              <h2 className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Actions</h2>
              <div className="grid gap-0.5">
                {user?.role === 'admin' ? (
                  <Button variant="ghost" className="justify-start" disabled={isSelf || busy} onClick={() => setDialog('demote')} title={isSelf ? 'You cannot demote yourself' : undefined}>
                    <ShieldOff className="h-4 w-4" /> Remove admin role
                  </Button>
                ) : (
                  <Button variant="ghost" className="justify-start" disabled={!user || busy} onClick={() => setDialog('promote')} title={!user ? 'User must sign in once first' : undefined}>
                    <ShieldCheck className="h-4 w-4" /> Make admin
                  </Button>
                )}
                <Button variant="ghost" className="justify-start" disabled={!user || busy} onClick={() => setDialog('grant')} title={!user ? 'User must sign in once first' : undefined}>
                  <Sparkles className="h-4 w-4" /> {activeGrant ? 'Replace donor boost' : 'Grant donor boost'}
                </Button>
                {activeGrant && (
                  <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => setDialog('revoke')}>
                    <Undo2 className="h-4 w-4" /> Revoke donor boost
                  </Button>
                )}
                {activeBan ? (
                  <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => setDialog('unban')}>
                    <Undo2 className="h-4 w-4" /> Lift ban
                  </Button>
                ) : (
                  <Button variant="ghost" className="justify-start text-destructive hover:text-destructive" disabled={isSelf || busy} onClick={() => setDialog('ban')} title={isSelf ? 'You cannot ban yourself' : undefined}>
                    <Ban className="h-4 w-4" /> Ban user
                  </Button>
                )}
              </div>
              {user?.isEnvAdmin && <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">Listed in the env allowlist; cannot be demoted from here.</p>}
            </div>
          </div>

          {/* Detail */}
          <div className="min-w-0 space-y-6">
            {activeBan && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive"><Ban className="h-4 w-4" /> Banned {activeBan.until ? `until ${formatDateTime(activeBan.until)}` : 'permanently'}</div>
                <p className="mt-2">{activeBan.reason}</p>
                <p className="mt-1 text-muted-foreground">By {activeBan.by}, {timeAgo(activeBan.at)}{activeBan.hiddenPageIds?.length ? ` · ${activeBan.hiddenPageIds.length} benchmark${activeBan.hiddenPageIds.length === 1 ? '' : 's'} hidden` : ''}</p>
              </div>
            )}

            {activeGrant && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm">
                <div className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {activeGrant.tierName}</div>
                <p className="mt-2 text-muted-foreground">Expires {formatDateTime(activeGrant.expiresAt)} ({timeAgo(activeGrant.expiresAt)})</p>
                <p className="text-muted-foreground">Granted {timeAgo(activeGrant.grantedAt)} by {activeGrant.grantedBy}{activeGrant.note ? ` — ${activeGrant.note}` : ''}</p>
              </div>
            )}

            {!activeGrant && user?.donorGrant && (
              <p className="text-sm text-muted-foreground">Previous donor boost expired {timeAgo(user.donorGrant.expiresAt)}.</p>
            )}

            <Section title="Benchmarks" description={data ? `${data.benchmarks.length}${data.benchmarks.length >= 50 ? '+' : ''} authored while signed in` : undefined} flush>
              {data && data.benchmarks.length === 0 ? <EmptyState>No benchmarks authored while signed in.</EmptyState> : (
                <Table minWidth={640}>
                  <thead><tr><Th>Title</Th><Th>Slug</Th><Th className="text-right">Revisions</Th><Th className="text-right">Tests</Th><Th>Visibility</Th><Th>Published</Th></tr></thead>
                  <tbody>
                    {data?.benchmarks.map((b) => (
                      <Tr key={b.slug}>
                        <Td><Link href={b.revision > 1 ? `/${b.slug}/${b.revision}` : `/${b.slug}`} className="line-clamp-1 font-medium">{b.title || 'Untitled'}</Link></Td>
                        <Td className="font-mono text-xs">{b.slug}</Td>
                        <Td className="text-right tabular-nums">{b.revisionCount}</Td>
                        <Td className="text-right tabular-nums">{b.testsCount}</Td>
                        <Td>{b.visible ? <Badge tone="good">public</Badge> : <Badge>hidden</Badge>}</Td>
                        <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(b.published)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>

            <Section title="Moderation history" flush>
              {data && data.audit.length === 0 ? <EmptyState>No admin actions recorded for this user.</EmptyState> : (
                <ul className="divide-y text-sm">
                  {data?.audit.map((entry, i) => (
                    <li key={`${entry.createdAt}-${i}`} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <span className="font-medium">{entry.action}</span>
                        <span className="text-muted-foreground"> by {entry.actorLogin || entry.actorId}</span>
                        {entry.details && Object.keys(entry.details).length > 0 && (
                          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{JSON.stringify(entry.details)}</div>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}

      <FormDialog
        open={dialog === 'ban'}
        onOpenChange={(open) => setDialog(open ? 'ban' : null)}
        title={`Ban ${displayName}`}
        description="Blocks sign-in, benchmark create/edit, run submission, deep analysis and reports. Public pages stay readable."
        submitLabel="Ban user"
        destructive
        busy={busy}
        onSubmit={submitBan}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="ban-reason">Reason</Label>
          <Input id="ban-reason" value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={500} placeholder="Spam benchmarks, abuse, …" required autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ban-days">Duration in days</Label>
          <Input id="ban-days" type="number" min={1} max={3650} value={banDays} onChange={(e) => setBanDays(e.target.value)} placeholder="Leave blank for permanent" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={hideContent} onChange={(e) => setHideContent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
          <span>Also unpublish all their benchmarks <span className="text-muted-foreground">(restored automatically when the ban is lifted)</span></span>
        </label>
      </FormDialog>

      <FormDialog
        open={dialog === 'grant'}
        onOpenChange={(open) => setDialog(open ? 'grant' : null)}
        title={activeGrant ? 'Replace donor boost' : 'Grant donor boost'}
        description={`Premium perks without a donation: higher rate limits, reports and worker-side analysis.${activeGrant ? ' This replaces the current grant.' : ''}`}
        submitLabel={activeGrant ? 'Replace grant' : 'Grant boost'}
        busy={busy}
        onSubmit={submitGrant}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="grant-days">Duration in days</Label>
            <Input id="grant-days" type="number" min={1} max={3650} value={grantDays} onChange={(e) => setGrantDays(e.target.value)} required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="grant-tier">Tier label</Label>
            <Input id="grant-tier" value={grantTier} onChange={(e) => setGrantTier(e.target.value)} maxLength={80} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="grant-note">Internal note</Label>
          <Input id="grant-note" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} maxLength={500} placeholder="Why this user gets a boost" />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={dialog === 'unban'}
        onOpenChange={(open) => setDialog(open ? 'unban' : null)}
        title={`Lift the ban on ${displayName}?`}
        description="Any benchmarks hidden by the ban are republished."
        confirmLabel="Lift ban"
        busy={busy}
        onConfirm={unban}
      />
      <ConfirmDialog
        open={dialog === 'revoke'}
        onOpenChange={(open) => setDialog(open ? 'revoke' : null)}
        title={`Revoke the donor boost for ${displayName}?`}
        confirmLabel="Revoke"
        destructive
        busy={busy}
        onConfirm={revokeGrant}
      />
      <ConfirmDialog
        open={dialog === 'promote'}
        onOpenChange={(open) => setDialog(open ? 'promote' : null)}
        title={`Make ${displayName} an admin?`}
        description="They get full access to this panel, including bans and grants."
        confirmLabel="Make admin"
        busy={busy}
        onConfirm={() => setRole('admin')}
      />
      <ConfirmDialog
        open={dialog === 'demote'}
        onOpenChange={(open) => setDialog(open ? 'demote' : null)}
        title={`Remove the admin role from ${displayName}?`}
        confirmLabel="Remove role"
        destructive
        busy={busy}
        onConfirm={() => setRole(null)}
      />
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
