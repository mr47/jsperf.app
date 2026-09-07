import type { GetServerSideProps } from 'next'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ShieldBan, Undo2 } from 'lucide-react'

import AdminShell from '../../components/admin/AdminShell'
import {
  adminFetch, EmptyState, ErrorNotice, formatDateTime, Section, Spinner, SuccessNotice, Table, Td, Th, timeAgo,
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
  const [busy, setBusy] = useState<string | null>(null)

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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy('add')
    setError(null)
    setNotice(null)
    try {
      await adminFetch('/api/admin/ip-bans', { method: 'POST', body: JSON.stringify({ ip: ip.trim(), reason: reason.trim(), days: Number(days) || 0 }) })
      setNotice(`Banned ${ip.trim()}.`)
      setIp(''); setReason(''); setDays('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add ban')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (target: string) => {
    if (!window.confirm(`Lift the ban on ${target}?`)) return
    setBusy(target)
    setError(null)
    setNotice(null)
    try {
      await adminFetch(`/api/admin/ip-bans?ip=${encodeURIComponent(target)}`, { method: 'DELETE' })
      setNotice(`Ban on ${target} lifted.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lift ban')
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminShell title="IP bans" description="Blocks anonymous write endpoints (create benchmark, submit runs, deep analysis) for an address. Error samples on the Errors page show the IP behind each request.">
      {notice && <div className="mb-4"><SuccessNotice message={notice} /></div>}
      {error && <div className="mb-4"><ErrorNotice message={error} onRetry={load} /></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Section title="Add IP ban">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ip">IP address</Label>
              <Input id="ip" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7 or 2001:db8::1" required className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-reason">Reason</Label>
              <Input id="ip-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-days">Duration (days, blank = permanent)</Label>
              <Input id="ip-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} placeholder="∞" />
            </div>
            <Button type="submit" size="sm" variant="destructive" disabled={busy !== null}>
              {busy === 'add' ? <Spinner /> : <ShieldBan className="h-4 w-4" />} Ban address
            </Button>
            <p className="text-xs text-muted-foreground">Most visitors sit behind carrier NAT or VPNs; prefer short durations and user bans when a GitHub account is involved.</p>
          </form>
        </Section>

        <Section title={`Active IP bans${items ? ` (${items.length})` : ''}`}>
          {loading && !items ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner /> Loading…</div>
          ) : items && items.length === 0 ? (
            <EmptyState>No IP bans.</EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>IP</Th><Th>Reason</Th><Th>By</Th><Th>Expires</Th><Th /></tr></thead>
              <tbody>
                {items?.map((ban) => {
                  const expired = ban.until && Date.parse(ban.until) <= Date.now()
                  return (
                    <tr key={ban.ip} className="border-t border-border/60">
                      <Td className="font-mono text-xs">{ban.ip}</Td>
                      <Td>{ban.reason}</Td>
                      <Td className="text-muted-foreground">{ban.by} · {timeAgo(ban.at)}</Td>
                      <Td className="whitespace-nowrap text-muted-foreground" title={ban.until ? formatDateTime(ban.until) : undefined}>{ban.until ? (expired ? 'expired' : timeAgo(ban.until)) : 'never'}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove(ban.ip)}>
                          {busy === ban.ip ? <Spinner /> : <Undo2 className="h-4 w-4" />} Lift
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Section>
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
