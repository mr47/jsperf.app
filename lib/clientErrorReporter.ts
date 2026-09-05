/**
 * Browser-side error reporter. Installs `error` / `unhandledrejection`
 * listeners once and forwards each distinct message (per page session)
 * to `POST /api/errors`. Deliberately conservative: a handful of reports
 * per page load at most, and never anything from the benchmark sandbox
 * (that document doesn't mount `_app`).
 */
const MAX_REPORTS_PER_SESSION = 5
const seen = new Set<string>()
let installed = false
let sent = 0

type Report = { message: string; stack?: string | null; name?: string | null; source: 'error' | 'unhandledrejection' }

function describe(reason: unknown): { message: string; stack: string | null; name: string | null } {
  if (reason instanceof Error) return { message: reason.message || reason.name, stack: reason.stack || null, name: reason.name }
  if (typeof reason === 'string') return { message: reason, stack: null, name: null }
  try { return { message: JSON.stringify(reason).slice(0, 500), stack: null, name: null } } catch (_) { return { message: String(reason), stack: null, name: null } }
}

function isNoise(message: string): boolean {
  // Browser-extension / third-party script noise that isn't actionable.
  return /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|__gCrWeb|Loading chunk \d+ failed/i.test(message)
}

function send(report: Report) {
  if (sent >= MAX_REPORTS_PER_SESSION) return
  const key = `${report.name || ''}|${report.message}`
  if (seen.has(key) || isNoise(report.message)) return
  seen.add(key)
  sent += 1
  const payload = JSON.stringify({
    message: report.message,
    stack: report.stack || undefined,
    name: report.name || undefined,
    url: window.location.href,
    source: report.source,
  })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/errors', new Blob([payload], { type: 'application/json' }))
      return
    }
    void fetch('/api/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
  } catch (_) {
    // ignore
  }
}

export function installClientErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    const { message, stack, name } = describe(event.error || event.message)
    if (!message) return
    send({ message, stack, name, source: 'error' })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const { message, stack, name } = describe(event.reason)
    if (!message) return
    send({ message, stack, name, source: 'unhandledrejection' })
  })
}
