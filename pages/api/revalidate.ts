import type { NextApiRequest, NextApiResponse } from 'next'
import { timingSafeEqual } from 'crypto'
import { logServerError } from '../../lib/errorLog'

/**
 * On-demand ISR revalidation. Secret-gated, and the path is restricted to
 * the pages this app actually statically renders so a leaked secret cannot
 * be used to trigger a revalidation storm across arbitrary routes.
 */
const STATIC_PATHS = new Set(['/', '/latest'])
const BENCHMARK_PATH = /^\/[a-z0-9][a-z0-9._-]{0,127}(?:\/\d{1,6})?$/i
const AUTHOR_PATH = /^\/u\/\d{1,20}$/

// Reserved top-level routes that look like benchmark slugs but are not ISR pages.
const RESERVED_TOP_LEVEL = new Set(['api', 'admin', 'banned', 'sandbox', '_next', 'r', 'u', 'sitemap'])

export function isAllowedRevalidatePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 160 || path !== path.trim()) return false
  if (path.includes('..') || path.includes('?') || path.includes('#') || path.includes('//')) return false
  if (STATIC_PATHS.has(path)) return true
  if (AUTHOR_PATH.test(path)) return true
  const first = path.split('/')[1]?.toLowerCase() || ''
  return BENCHMARK_PATH.test(path) && !RESERVED_TOP_LEVEL.has(first)
}

function secretMatches(provided: unknown, expected: string | undefined) {
  if (!expected || typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  if (!secretMatches(req.query.secret, process.env.REVALIDATE_SECRET)) {
    return res.status(401).json({ message: 'Invalid token' })
  }

  const path = typeof req.query.path === 'string' ? req.query.path : null
  if (!isAllowedRevalidatePath(path)) {
    return res.status(400).json({ message: 'Path is not eligible for revalidation' })
  }

  try {
    await res.revalidate(path)
    return res.json({ revalidated: true, path })
  } catch (err) {
    // Next keeps serving the last good render, so this is non-fatal.
    void logServerError('revalidate', err, { req })
    return res.status(500).json({ revalidated: false, message: 'Error revalidating' })
  }
}
