import crypto from 'crypto'

/**
 * Replace a secret-ish value (promo/verification code, donor name) with a
 * short stable fingerprint so log lines stay correlatable without leaking
 * the value into log drains.
 */
export function redactForLog(value: unknown): string {
  if (value == null || value === '') return '<empty>'
  const str = String(value)
  const digest = crypto.createHash('sha256').update(str).digest('hex').slice(0, 8)
  return `<redacted len=${str.length} h=${digest}>`
}
