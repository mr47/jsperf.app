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

export async function claimPromoCode({ code, email, name }) {
  const normalizedCode = normalizeCode(code)

  if (!email || typeof email !== 'string') {
    return {
      ok: false,
      status: 401,
      error: 'Sign in with GitHub before redeeming a promo code.',
    }
  }

  const normalizedEmail = normalizeEmail(email)
  const collection = await promoCodesCollection()
  const promo = await getPromo(collection, normalizedCode)

  if (!promo) {
    return {
      ok: false,
      status: 404,
      error: 'Promo code not found.',
    }
  }

  if (!isAllowedEmail(normalizedEmail, promo.allowedEmailDomain)) {
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
