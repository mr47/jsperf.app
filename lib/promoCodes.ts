import { DONOR_SESSION_TTL_SECONDS } from './donorAuth'
import { promoCodesCollection } from './mongodb'

const DEFAULT_PROMO_CODES = {
  AE: {
    type: 'code',
    code: 'AE',
    ttlSeconds: DONOR_SESSION_TTL_SECONDS,
    tierName: 'AE promo',
    allowedEmailDomain: 'agileengine.com',
    active: true,
  },
}

function normalizeCode(code) {
  if (!code || typeof code !== 'string') return ''
  return code.trim().toUpperCase()
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return ''
  return email.trim().toLowerCase()
}

function maskEmail(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  const [local, domain] = normalizedEmail.split('@')
  if (!domain) return 'invalid-email'
  return `${local?.slice(0, 2) || '**'}***@${domain}`
}

function emailDomains(emails) {
  return Array.from(new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => normalizeEmail(email).split('@')[1])
      .filter(Boolean)
  ))
}

function isAllowedEmail(email, domain) {
  if (!domain) return true
  return normalizeEmail(email).endsWith(`@${String(domain).toLowerCase()}`)
}

function dateMs(value) {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  return Date.parse(value)
}

function promoDonor({ promo, email, name }) {
  const normalizedEmail = normalizeEmail(email)
  return {
    name: name || normalizedEmail.split('@')[0] || 'Promo user',
    source: 'promo',
    amount: 0,
    currency: 'UAH',
    tierName: promo.tierName,
    email: normalizedEmail,
    via: 'promo',
    promoCode: promo.code,
  }
}

async function getPromo(collection, code) {
  const seededPromo = DEFAULT_PROMO_CODES[code]
  if (seededPromo) {
    const now = new Date()
    await collection.updateOne(
      { type: 'code', code },
      {
        $setOnInsert: {
          ...seededPromo,
          createdAt: now,
        },
        $set: {
          updatedAt: now,
        },
      },
      { upsert: true },
    )
  }

  return collection.findOne({ type: 'code', code, active: true })
}

function claimFromRedemption({ promo, redemption, now, fallbackName }) {
  const expiresAtMs = dateMs(redemption.expiresAt)
  if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
    return {
      ok: true,
      promo,
      ttlSeconds: Math.max(1, Math.floor((expiresAtMs - now) / 1000)),
      match: promoDonor({ promo, email: redemption.email, name: redemption.name || fallbackName }),
      alreadyRedeemed: true,
    }
  }

  return {
    ok: false,
    status: 409,
    error: 'This promo code was already used by this account.',
  }
}

export async function claimPromoCode({ code, email, emails = [], name }) {
  const normalizedCode = normalizeCode(code)
  const candidateEmails = Array.from(new Set(
    [email, ...(Array.isArray(emails) ? emails : [])]
      .map(normalizeEmail)
      .filter(Boolean)
  ))

  console.info('[promo-code] claim candidates', {
    code: normalizedCode,
    candidateCount: candidateEmails.length,
    candidateDomains: emailDomains(candidateEmails),
    hasAgileEngineEmail: candidateEmails.some((candidateEmail) => candidateEmail.endsWith('@agileengine.com')),
  })

  if (candidateEmails.length === 0) {
    return {
      ok: false,
      status: 401,
      error: 'GitHub did not provide an email. Please reconnect GitHub and approve email access.',
    }
  }

  const collection = await promoCodesCollection()
  const promo = await getPromo(collection, normalizedCode)

  if (!promo) {
    console.info('[promo-code] missing promo config', { code: normalizedCode })
    return {
      ok: false,
      status: 404,
      error: 'Promo code not found.',
    }
  }

  const normalizedEmail = promo.allowedEmailDomain
    ? candidateEmails.find((candidateEmail) => isAllowedEmail(candidateEmail, promo.allowedEmailDomain))
    : candidateEmails[0]

  if (!isAllowedEmail(normalizedEmail, promo.allowedEmailDomain)) {
    console.info('[promo-code] email domain rejected', {
      code: normalizedCode,
      allowedEmailDomain: promo.allowedEmailDomain,
      candidateDomains: emailDomains(candidateEmails),
    })
    return {
      ok: false,
      status: 403,
      error: `This promo code requires an @${promo.allowedEmailDomain} email.`,
    }
  }

  const now = Date.now()
  const existing = await collection.findOne({
    type: 'redemption',
    code: promo.code,
    email: normalizedEmail,
  })

  if (existing) {
    console.info('[promo-code] found existing redemption', {
      code: promo.code,
      email: maskEmail(normalizedEmail),
      expiresAt: existing.expiresAt,
    })
    return claimFromRedemption({ promo, redemption: existing, now, fallbackName: name })
  }

  const redeemedAt = new Date(now)
  const expiresAt = new Date(now + promo.ttlSeconds * 1000)
  const match = promoDonor({ promo, email: normalizedEmail, name })

  try {
    await collection.insertOne({
      type: 'redemption',
      code: promo.code,
      email: normalizedEmail,
      name: match.name,
      redeemedAt,
      expiresAt,
    })
  } catch (err) {
    if (err?.code !== 11000) throw err
    console.info('[promo-code] redemption insert race', {
      code: promo.code,
      email: maskEmail(normalizedEmail),
    })
    const redemption = await collection.findOne({
      type: 'redemption',
      code: promo.code,
      email: normalizedEmail,
    })
    if (redemption) return claimFromRedemption({ promo, redemption, now, fallbackName: name })
    throw err
  }

  return {
    ok: true,
    promo,
    ttlSeconds: promo.ttlSeconds,
    match,
    alreadyRedeemed: false,
  }
}
