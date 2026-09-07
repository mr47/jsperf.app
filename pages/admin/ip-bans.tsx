import type { GetServerSideProps } from 'next'
import { useCallback, useEffect, useState } from 'react'
import { ShieldBan, Undo2 } from 'lucide-react'

import AdminShell from '../../components/admin/AdminShell'
import {
  adminFetch, ConfirmDialog, EmptyState, FormDialog, formatDateTime, LoadingState, Notices, Table, Td, Th, timeAgo, Tr,
} from '../../components/admin/primitives'
import { requireAdminSsr } from '../../lib/admin'
import type { BanRecord } from '../../lib/users'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type IpBan = BanRecord & { ip: string }

export default function AdminIpBans() {
  const [items, setItems] = useState<IpBan[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [lifting, setLifting] = useState<string | null>(null)

  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminFetch<{ items: IpBan[] }>('/api/admin/ip-bans')
      setItems(result.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IP bans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async () => {
    const target = ip.trim()
    if (!target) throw new Error('An IP address is required.')
    if (!reason.trim()) throw new Error('A reason is required.')
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminFetch('/api/admin/ip-bans', { method: 'POST', body: JSON.stringify({ ip: target, reason: reason.trim(), days: Number(days) || 0 }) })
      setNotice(`Banned ${target}.`)
      setIp(''); setReason(''); setDays('')
      setAdding(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const target = lifting
    if (!target) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminFetch(`/api/admin/ip-bans?ip=${encodeURIComponent(target)}`, { method: 'DELETE' })
      setNotice(`Ban on ${target} lifted.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lift ban')
    } finally {
      setBusy(false)
      setLifting(null)
    }
  }

  return (
    <AdminShell
      title="IP bans"
      description="Blocks anonymous write endpoints (create benchmark, submit runs, deep analysis) for an address. Error samples on the Errors page show the IP behind each request."
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'IP bans' }]}
      actions={
        <Button size="sm" onClick={() => setAdding(true)} disabled={busy}>
          <ShieldBan className="h-4 w-4" /> Ban an address
        </Button>
      }
    >
      <Notices notice={notice} error={error} onRetry={load} />

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {loading && !items ? (
          <LoadingState />
        ) : items && items.length === 0 ? (
          <EmptyState>No IP bans. Most visitors sit behind carrier NAT or VPNs, so prefer short durations and user bans when a GitHub account is involved.</EmptyState>
        ) : (
          <Table minWidth={640}>
            <thead><tr><Th>IP</Th><Th>Reason</Th><Th>By</Th><Th>Expires</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {items?.map((ban) => {
                const expired = ban.until && Date.parse(ban.until) <= Date.now()
                return (
                  <Tr key={ban.ip}>
                    <Td className="font-mono text-xs">{ban.ip}</Td>
                    <Td>{ban.reason}</Td>
                    <Td className="text-muted-foreground">{ban.by} · {timeAgo(ban.at)}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground" title={ban.until ? formatDateTime(ban.until) : undefined}>{ban.until ? (expired ? 'expired' : timeAgo(ban.until)) : 'never'}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLifting(ban.ip)}>
                        <Undo2 className="h-4 w-4" /> Lift
                      </Button>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </div>

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Ban an IP address"
        description="Prefer short durations: most visitors sit behind carrier NAT or VPNs. When a GitHub account is involved, ban the user instead."
        submitLabel="Ban address"
        destructive
        busy={busy}
        onSubmit={submit}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="ip">IP address</Label>
          <Input id="ip" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7 or 2001:db8::1" required className="font-mono" autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ip-reason">Reason</Label>
          <Input id="ip-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ip-days">Duration in days</Label>
          <Input id="ip-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} placeholder="Leave blank for permanent" />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={lifting !== null}
        onOpenChange={(open) => { if (!open && !busy) setLifting(null) }}
        title={`Lift the ban on ${lifting ?? ''}?`}
        confirmLabel="Lift ban"
        busy={busy}
        onConfirm={remove}
      />
    </AdminShell>
  )
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const guard = await requireAdminSsr(ctx)
  if ('redirect' in guard) return { redirect: guard.redirect }
  if ('notFound' in guard) return { notFound: true }
  return { props: {} }
}
