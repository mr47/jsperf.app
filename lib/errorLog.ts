/**
 * Persistent error log for the admin panel.
 *
 * `logServerError(scope, error, context)` always writes to `console.error`
 * (so Vercel logs keep working) and additionally upserts a grouped record
 * into the `errors` collection:
 *
 *   one document per (fingerprint, hour bucket) with a `count`, first/last
 *   seen timestamps, the latest stack, and a few sample contexts.
 *
 * Grouping keeps a runaway failure from writing thousands of documents,
 * and an in-process throttle stops us from hammering MongoDB even when
 * every request fails. The function never throws and never awaits more
 * than the caller wants: use `void logServerError(...)` on hot paths.
 */
import crypto from 'crypto'
import type { IncomingMessage } from 'http'
import { errorsCollection } from './mongodb'

export type ErrorLevel = 'error' | 'warn'

export type ErrorContext = {
  req?: IncomingMessage & { url?: string; method?: string }
  userId?: string | null
  status?: number
  level?: ErrorLevel
  /** Origin of the report: server code path or browser. */
  source?: 'server' | 'client'
  [key: string]: unknown
}

export type ErrorDoc = {
  fingerprint: string
  bucket: string
  scope: string
  level: ErrorLevel
  source: 'server' | 'client'
  message: string
  stack: string | null
  count: number
  firstSeenAt: Date
  lastSeenAt: Date
  samples: Array<Record<string, unknown>>
  resolvedAt?: Date | null
}

const MAX_MESSAGE = 1000
const MAX_STACK = 6000
const MAX_SAMPLES = 5
const THROTTLE_WINDOW_MS = 60_000
const THROTTLE_MAX_PER_FINGERPRINT = 20

const throttle = new Map<string, { windowStart: number; count: number }>()

function truncate(value: unknown, max: number): string {
  const text = value == null ? '' : String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describeError(error: unknown): { message: string; stack: string | null; name: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack || null, name: error.name }
  }
  if (typeof error === 'string') return { message: error, stack: null, name: 'Error' }
  try {
    return { message: JSON.stringify(error), stack: null, name: 'Error' }
  } catch (_) {
    return { message: String(error), stack: null, name: 'Error' }
  }
}

/**
 * Stable grouping key: scope + error name + message with volatile tokens
 * (numbers, hex ids, quoted strings) collapsed + first stack frame.
 */
export function fingerprintError(scope: string, message: string, stack: string | null, name = 'Error'): string {
  const normalizedMessage = message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200)
  const firstFrame = (stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ')) || ''
  const frame = firstFrame.replace(/:\d+:\d+\)?$/, '')
  return crypto.createHash('sha1').update(`${scope}|${name}|${normalizedMessage}|${frame}`).digest('hex').slice(0, 20)
}

function hourBucket(date: Date): string {
  return date.toISOString().slice(0, 13)
}

function shouldWrite(fingerprint: string, now: number): boolean {
  const entry = throttle.get(fingerprint)
  if (!entry || now - entry.windowStart > THROTTLE_WINDOW_MS) {
    throttle.set(fingerprint, { windowStart: now, count: 1 })
    if (throttle.size > 5000) throttle.clear()
    return true
  }
  entry.count += 1
  return entry.count <= THROTTLE_MAX_PER_FINGERPRINT
}

function sampleFromContext(context: ErrorContext): Record<string, unknown> {
  const { req, level: _level, source: _source, ...rest } = context
  const sample: Record<string, unknown> = { at: new Date().toISOString() }
  if (req) {
    sample.method = req.method || null
    sample.url = truncate(req.url, 300) || null
    const fwd = req.headers?.['x-forwarded-for']
    sample.ip = typeof fwd === 'string' ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress || null)
    sample.userAgent = truncate(req.headers?.['user-agent'], 200) || null
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue
    sample[key] = typeof value === 'string' ? truncate(value, 500) : value
  }
  return sample
}

/**
 * Record an error. Safe to call without awaiting.
 */
export async function logServerError(scope: string, error: unknown, context: ErrorContext = {}): Promise<void> {
  const { message, stack, name } = describeError(error)
  const level: ErrorLevel = context.level || 'error'
  const source = context.source || 'server'

  if (level === 'warn') console.warn(`[${scope}]`, error)
  else console.error(`[${scope}]`, error)

  if (process.env.ERROR_LOG_DISABLED === '1') return

  try {
    const fingerprint = fingerprintError(scope, message, stack, name)
    const now = Date.now()
    if (!shouldWrite(fingerprint, now)) return

    const date = new Date(now)
    const sample = sampleFromContext(context)
    const errors = await errorsCollection()
    await errors.updateOne(
      { fingerprint, bucket: hourBucket(date) },
      {
        $setOnInsert: { fingerprint, bucket: hourBucket(date), scope, level, source, firstSeenAt: date, resolvedAt: null },
        $set: {
          message: truncate(message, MAX_MESSAGE),
          stack: stack ? truncate(stack, MAX_STACK) : null,
          lastSeenAt: date,
        },
        $inc: { count: 1 },
        $push: { samples: { $each: [sample], $slice: -MAX_SAMPLES } },
      },
      { upsert: true },
    )
  } catch (err) {
    // The log must never take down the request it is describing.
    console.warn('[error-log] persist failed', (err as Error)?.message || err)
  }
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export type ErrorListFilter = {
  scope?: string
  source?: 'server' | 'client'
  status?: 'open' | 'resolved' | 'all'
  q?: string
  page?: number
  pageSize?: number
}

export async function listErrors({ scope, source, status = 'open', q = '', page = 1, pageSize = 50 }: ErrorListFilter = {}) {
  const errors = await errorsCollection()
  const query: Record<string, unknown> = {}
  if (scope) query.scope = scope
  if (source) query.source = source
  if (status === 'open') query.resolvedAt = null
  if (status === 'resolved') query.resolvedAt = { $ne: null }
  const trimmed = q.trim()
  if (trimmed) {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    query.message = { $regex: escaped, $options: 'i' }
  }
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(200, Math.max(1, Math.floor(pageSize)))
  const [items, total, scopes] = await Promise.all([
    errors.find(query).sort({ lastSeenAt: -1 }).skip((safePage - 1) * safeSize).limit(safeSize).toArray(),
    errors.countDocuments(query, { maxTimeMS: 5000 }),
    errors.distinct('scope'),
  ])
  return {
    items: items.map((doc) => ({ ...doc, _id: String(doc._id) })),
    total,
    page: safePage,
    pageSize: safeSize,
    scopes: (scopes as string[]).sort(),
  }
}

export async function errorSummary(sinceMs = 24 * 60 * 60 * 1000) {
  const errors = await errorsCollection()
  const since = new Date(Date.now() - sinceMs)
  const rows = await errors.aggregate([
    { $match: { lastSeenAt: { $gte: since }, resolvedAt: null } },
    { $group: { _id: '$scope', count: { $sum: '$count' }, groups: { $sum: 1 }, lastSeenAt: { $max: '$lastSeenAt' } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray()
  return rows.map((r) => ({ scope: r._id as string, count: r.count as number, groups: r.groups as number, lastSeenAt: r.lastSeenAt as Date }))
}

export async function resolveErrors(ids: string[], resolved: boolean) {
  const { ObjectId } = await import('mongodb')
  const objectIds = ids
    .map((id) => { try { return new ObjectId(id) } catch (_) { return null } })
    .filter((v): v is InstanceType<typeof ObjectId> => v !== null)
  if (!objectIds.length) return 0
  const errors = await errorsCollection()
  const result = await errors.updateMany({ _id: { $in: objectIds } }, { $set: { resolvedAt: resolved ? new Date() : null } })
  return result.modifiedCount || 0
}

export async function deleteErrors({ ids, resolvedOnly }: { ids?: string[]; resolvedOnly?: boolean }) {
  const errors = await errorsCollection()
  if (resolvedOnly) {
    const result = await errors.deleteMany({ resolvedAt: { $ne: null } })
    return result.deletedCount || 0
  }
  if (!ids?.length) return 0
  const { ObjectId } = await import('mongodb')
  const objectIds = ids
    .map((id) => { try { return new ObjectId(id) } catch (_) { return null } })
    .filter((v): v is InstanceType<typeof ObjectId> => v !== null)
  const result = await errors.deleteMany({ _id: { $in: objectIds } })
  return result.deletedCount || 0
}
