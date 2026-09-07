import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
// Tones
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'danger'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-blue-600 dark:text-blue-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
}

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/50',
  info: 'bg-blue-500',
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-destructive',
}

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'border-border bg-muted/60 text-muted-foreground',
  info: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  good: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
}

// ---------------------------------------------------------------------------
// Layout bits
// ---------------------------------------------------------------------------

type StatCardProps = {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: LucideIcon
  tone?: Tone
  loading?: boolean
}

export function StatCard({ label, value, detail, icon: Icon, tone = 'neutral', loading }: StatCardProps) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', TONE_TEXT[tone])} aria-hidden="true" />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      )}
      {detail && <div className="mt-1.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  )
}

type BadgeProps = { children: ReactNode; tone?: Tone; className?: string }

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE_BADGE[tone], className)}>
      {children}
    </span>
  )
}

/** Compact health indicator: coloured dot, label and a short value. */
export function StatusChip({ label, value, tone = 'neutral', href }: { label: string; value: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </>
  )
  const className = 'inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm'
  if (href) {
    return <a href={href} className={cn(className, 'transition-colors hover:bg-muted/50 hover:no-underline')}>{body}</a>
  }
  return <span className={className}>{body}</span>
}

type SectionProps = {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Remove body padding so tables and lists can span the full card. */
  flush?: boolean
}

export function Section({ title, description, actions, children, className, flush }: SectionProps) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card shadow-sm', className)}>
      <header className="flex flex-col gap-2 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  )
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-10 text-center text-sm text-muted-foreground', className)}>{children}</div>
}

export function LoadingState({ children = 'Loading…', className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground', className)}>
      <Spinner /> {children}
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

export function SuccessNotice({ message }: { message: string }) {
  return <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</div>
}

/** Stacks the page-level success / error notices with consistent spacing. */
export function Notices({ notice, error, onRetry }: { notice?: string | null; error?: string | null; onRetry?: () => void }) {
  if (!notice && !error) return null
  return (
    <div className="mb-5 space-y-2">
      {notice && <SuccessNotice message={notice} />}
      {error && <ErrorNotice message={error} onRetry={onRetry} />}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />
}

/** Filter / search row above a table. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between', className)}>{children}</div>
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
      <span>Page {page} of {pages} · {formatNumber(total)} total</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className, minWidth = 640 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm" style={{ minWidth }}>{children}</table>
    </div>
  )
}

export function Th({ children, className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('bg-muted/40 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground first:pl-5 last:pr-5', className)} {...props}>{children}</th>
}

export function Td({ children, className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle first:pl-5 last:pr-5', className)} {...props}>{children}</td>
}

export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('border-t transition-colors hover:bg-muted/30', className)} {...props} />
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

/** Label / value rows for profile-style panels. */
export function KeyValueList({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

/** Replacement for window.confirm with a proper dialog. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, busy, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={() => void onConfirm()}>
            {busy && <Spinner />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type FormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  submitLabel: string
  destructive?: boolean
  busy?: boolean
  /** Throw to show an inline validation error and keep the dialog open. */
  onSubmit: () => Promise<void> | void
  children: ReactNode
}

/** Dialog wrapping a small form; the caller owns the field state. */
export function FormDialog({ open, onOpenChange, title, description, submitLabel, destructive, busy, onSubmit, children }: FormDialogProps) {
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    try {
      await onSubmit()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setLocalError(null); onOpenChange(next) } }}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-3">{children}</div>
          {localError && <p role="alert" className="text-sm text-destructive">{localError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy}>
              {busy && <Spinner />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
