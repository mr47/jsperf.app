import type { ComponentProps, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const abs = Math.abs(diff)
  const units: Array<[number, string]> = [
    [31_536_000_000, 'y'], [2_592_000_000, 'mo'], [604_800_000, 'w'], [86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'm'],
  ]
  let text = `${Math.round(abs / 1000)}s`
  for (const [size, label] of units) {
    if (abs >= size) { text = `${Math.round(abs / size)}${label}`; break }
  }
  return diff < 0 ? `in ${text}` : `${text} ago`
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

export class AdminApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function adminFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AdminApiError((data && (data.error || data.message)) || `Request failed (${res.status})`, res.status)
  }
  return data as T
}

// ---------------------------------------------------------------------------
// Layout bits
// ---------------------------------------------------------------------------

type StatCardProps = {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: LucideIcon
  tone?: 'default' | 'warn' | 'danger' | 'good'
  loading?: boolean
}

const TONE: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
  good: 'text-emerald-600 dark:text-emerald-400',
}

export function StatCard({ label, value, detail, icon: Icon, tone = 'default', loading }: StatCardProps) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          {Icon && <Icon className={cn('h-4 w-4', TONE[tone])} />}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        )}
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  )
}

type BadgeProps = { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'good' | 'info'; className?: string }

const BADGE_TONE: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'border-border bg-muted/50 text-muted-foreground',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
}

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE_TONE[tone], className)}>
      {children}
    </span>
  )
}

export function Section({ title, description, actions, children, className }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </Card>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

export function SuccessNotice({ message }: { message: string }) {
  return <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{message}</div>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
      <span>Page {page} of {pages} · {formatNumber(total)} total</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-4 overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground', className)} {...props}>{children}</th>
}

export function Td({ children, className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-2.5 align-top', className)} {...props}>{children}</td>
}

export function Avatar({ src, alt, size = 28 }: { src: string | null | undefined; alt: string; size?: number }) {
  if (!src) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground" style={{ width: size, height: size }}>
        {alt.slice(0, 2)}
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- GitHub avatars are arbitrary remote hosts; next/image would need a remotePatterns entry per CDN.
  return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" loading="lazy" />
}
