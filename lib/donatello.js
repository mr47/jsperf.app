/**
 * Thin wrapper around the Donatello REST API.
 *
 *   Base:     https://donatello.to/api/v1
 *   Auth:     header `X-Token: <DONATELLO_TOKEN>`
 *
 * Used by the donor-boost feature: when a user claims a donation we hit
 * `/donates` (and `/subscribers` for recurring supporters) with the
 * project owner's token and look for a matching record. Only used
 * server-side — the token never leaves the function.
 *
 * Note: Donatello rate-limits the API itself (~15 req/min per token), so
 * callers should keep the lookup window short and rely on the donor
 * session in Redis instead of re-querying on every request.
 */

const API_BASE = 'https://donatello.to/api/v1'
const DEFAULT_LOOKUP_PAGE_SIZE = 100

function getToken() {
  const token = process.env.DONATELLO_TOKEN
  if (!token) {
    throw new Error('DONATELLO_TOKEN env var is not configured')
  }
  return token
}

async function request(path, params) {
  const url = new URL(API_BASE + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }

  const res = await fetch(url, {
    headers: {
      'X-Token': getToken(),
      'Accept': 'application/json',
    },
  })

  let data = null
  try {
    data = await res.json()
  } catch (_) {
    // Non-JSON response — treated as an error below.
  }

  if (!res.ok || (data && data.success === false)) {
    const msg = data?.message || `Donatello API error (HTTP ${res.status})`
    const err = new Error(msg)
    err.status = res.status
    err.body = data
    throw err
  }

  return data || {}
}

export async function fetchDonates({ page = 0, size = DEFAULT_LOOKUP_PAGE_SIZE } = {}) {
  return request('/donates', { page, size })
}

export async function fetchSubscribers({ isActive = true, page = 0, size = DEFAULT_LOOKUP_PAGE_SIZE } = {}) {
  return request('/subscribers', { isActive, page, size })
}

function normaliseName(s) {
  return (s || '').toString().trim().toLowerCase()
}

function normaliseEmail(s) {
  return (s || '').toString().trim().toLowerCase()
}

/**
 * Donatello returns one-off donations under `content` in the live API
 * (paginated wrapper), even though older docs / the Python wrapper
 * call the field `donates`. We accept either to stay compatible.
 */
function extractDonates(payload) {
  if (!payload) return []
  if (Array.isArray(payload.content)) return payload.content
  if (Array.isArray(payload.donates)) return payload.donates
  if (Array.isArray(payload)) return payload
  return []
}

function extractSubscribers(payload) {
  if (!payload) return []
  if (Array.isArray(payload.subscribers)) return payload.subscribers
  if (Array.isArray(payload.content)) return payload.content
  if (Array.isArray(payload)) return payload
  return []
}

/**
 * Look up a donor by nickname against recent one-off donations and
 * active subscribers.
 *
 * If `code` is provided we also require it to appear in the donate
 * `message` field. This is the "anti-impersonation" check: a user
 * proves they own a given Donatello name by including a code we
 * generated for them in their donation message.
 *
 * Active recurring subscribers are accepted by name alone — they're a
 * stronger signal than a one-off and the relationship is ongoing.
 *
 * Returns the matched record, or null if none was found. Throws if
 * the API call fails for both endpoints.
 */
export async function findDonorMatch({ name, code } = {}) {
  const wanted = normaliseName(name)
  if (!wanted) return null

  const wantedCode = code ? code.toString().trim().toLowerCase() : null

  const [donatesRes, subsRes] = await Promise.allSettled([
    fetchDonates({ page: 0, size: DEFAULT_LOOKUP_PAGE_SIZE }),
    fetchSubscribers({ isActive: true, page: 0, size: DEFAULT_LOOKUP_PAGE_SIZE }),
  ])

  const inspectedNames = []

  if (donatesRes.status === 'fulfilled') {
    for (const d of extractDonates(donatesRes.value)) {
      const candidate = normaliseName(d.clientName)
      inspectedNames.push(d.clientName)
      if (candidate !== wanted) continue
      if (wantedCode) {
        // Accept the code in either the donation message (the
        // documented anti-impersonation flow) or the public donate id
        // (`pubId`, what users see on Donatello receipts and what
        // most people will reach for first). Both are case-insensitive.
        const msg = (d.message || '').toLowerCase()
        const pubId = (d.pubId || '').toLowerCase()
        if (!msg.includes(wantedCode) && pubId !== wantedCode) continue
      }
      return {
        source: 'donate',
        name: d.clientName,
        amount: parseFloat(d.amount) || 0,
        currency: d.currency || 'UAH',
        message: d.message || null,
        createdAt: d.createdAt || null,
      }
    }
  } else {
    console.warn('[donatello] donates fetch failed:', donatesRes.reason?.message || donatesRes.reason)
  }

  if (subsRes.status === 'fulfilled') {
    for (const s of extractSubscribers(subsRes.value)) {
      inspectedNames.push(s.clientName)
      if (normaliseName(s.clientName) !== wanted) continue
      return {
        source: 'subscriber',
        name: s.clientName,
        amount: parseFloat(s.amount) || 0,
        currency: s.currency || 'UAH',
        tierName: s.tierName || null,
        createdAt: s.createdAt || null,
      }
    }
  } else {
    console.warn('[donatello] subscribers fetch failed:', subsRes.reason?.message || subsRes.reason)
  }

  if (donatesRes.status === 'rejected' && subsRes.status === 'rejected') {
    throw donatesRes.reason
  }

  console.info(
    `[donatello] no match for ${JSON.stringify(name)}` +
    (code ? ` with code ${JSON.stringify(code)}` : '') +
    ` — inspected ${inspectedNames.length} record(s): ${JSON.stringify(inspectedNames)}`
  )

  return null
}

/**
 * Look up a donor by email. Useful for auto-matching a signed-in
 * GitHub user (whose primary email we already know) against Donatello
 * subscribers and one-off donors without making them re-enter
 * anything.
 *
 * The `clientEmail` field is documented on `/subscribers` and is also
 * present on `/donates` for donations made by logged-in Donatello
 * users / passed via the donate form.
 */
export async function findDonorByEmail(email) {
  const wanted = normaliseEmail(email)
  if (!wanted) return null

  const [donatesRes, subsRes] = await Promise.allSettled([
    fetchDonates({ page: 0, size: DEFAULT_LOOKUP_PAGE_SIZE }),
    fetchSubscribers({ isActive: true, page: 0, size: DEFAULT_LOOKUP_PAGE_SIZE }),
  ])

  // Active subscribers are the strongest signal — try them first.
  // (`/donates` doesn't expose `clientEmail`, only `/subscribers`
  // does, so that's effectively where this matching happens.)
  if (subsRes.status === 'fulfilled') {
    for (const s of extractSubscribers(subsRes.value)) {
      if (normaliseEmail(s.clientEmail) !== wanted) continue
      return {
        source: 'subscriber',
        name: s.clientName || email,
        amount: parseFloat(s.amount) || 0,
        currency: s.currency || 'UAH',
        tierName: s.tierName || null,
        email: wanted,
        createdAt: s.createdAt || null,
      }
    }
  }

  if (donatesRes.status === 'fulfilled') {
    for (const d of extractDonates(donatesRes.value)) {
      if (normaliseEmail(d.clientEmail) !== wanted) continue
      return {
        source: 'donate',
        name: d.clientName || email,
        amount: parseFloat(d.amount) || 0,
        currency: d.currency || 'UAH',
        message: d.message || null,
        email: wanted,
        createdAt: d.createdAt || null,
      }
    }
  }

  if (donatesRes.status === 'rejected' && subsRes.status === 'rejected') {
    throw donatesRes.reason
  }

  return null
}
