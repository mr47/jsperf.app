// @ts-nocheck
import NextAuth from "next-auth"
import GitHubProvider from "next-auth/providers/github"

function maskEmail(email) {
  if (!email || typeof email !== 'string') return null
  const [local, domain] = email.toLowerCase().split('@')
  if (!domain) return 'invalid-email'
  return `${local?.slice(0, 2) || '**'}***@${domain}`
}

function emailDomains(emails) {
  return Array.from(new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => String(email || '').toLowerCase().split('@')[1])
      .filter(Boolean)
  ))
}

function truncateLogValue(value, max = 500) {
  if (!value) return ''
  const text = String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function tokenPrefix(token) {
  if (!token || typeof token !== 'string') return null
  const [prefix] = token.split('_')
  return prefix || null
}

export default NextAuth({
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
      authorization: 'https://github.com/login/oauth/authorize?scope=read:user%20user:email',
    })
  ],

  session: {
    strategy: 'jwt',
    maxAge: 90 * 24 * 60 * 60, // 90 days
  },

  jwt: {
  },

  secret: process.env.NEXTAUTH_SECRET,

  callbacks: {
    signIn: async ({ account, user, profile }) => {
      if (account?.provider !== 'github') return true

      console.info('[auth-github] signIn start', {
        scope: account?.scope || null,
        accountType: account?.type || null,
        tokenType: account?.token_type || null,
        accessTokenPrefix: tokenPrefix(account?.access_token),
        hasAccessToken: !!account?.access_token,
        profileEmail: maskEmail(profile?.email),
        initialUserEmail: maskEmail(user?.email),
      })

      // Try to upgrade to the user's primary email via the GitHub
      // emails endpoint. This requires the `user:email` scope (set by
      // NextAuth's GitHub provider by default). If anything goes wrong
      // — network blip, rate-limit, missing scope, GitHub returning an
      // error object instead of an array — we fall back silently to
      // whatever `profile.email`/`user.email` we already have, rather
      // than aborting sign-in (which would 500 -> /api/auth/error).
      try {
        const res = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${account.access_token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'jsperf.net',
          },
        })
        console.info('[auth-github] /user/emails response', {
          status: res.status,
          ok: res.ok,
          rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
          acceptedOauthScopes: res.headers.get('x-accepted-oauth-scopes'),
          oauthScopes: res.headers.get('x-oauth-scopes'),
        })
        if (res.ok) {
          const emails = await res.json().catch(() => null)
          console.info('[auth-github] /user/emails parsed', {
            isArray: Array.isArray(emails),
            count: Array.isArray(emails) ? emails.length : 0,
            domains: emailDomains(Array.isArray(emails) ? emails.map((entry) => entry?.email) : []),
            verifiedCount: Array.isArray(emails) ? emails.filter((entry) => entry?.verified !== false).length : 0,
            hasAgileEngine: Array.isArray(emails) ? emails.some((entry) => String(entry?.email || '').toLowerCase().endsWith('@agileengine.com')) : false,
          })
          if (Array.isArray(emails) && emails.length > 0) {
            const verifiedEmails = emails
              .filter((entry) => entry?.email && entry?.verified !== false)
              .map((entry) => String(entry.email).toLowerCase())
            const agileEngineEmail = verifiedEmails.find((email) => email.endsWith('@agileengine.com'))
            const primary = [...emails].sort((a, b) =>
              (b?.primary === true) - (a?.primary === true)
            )[0]
            user.emails = verifiedEmails
            if (agileEngineEmail) user.email = agileEngineEmail
            else if (primary?.email) user.email = primary.email
            console.info('[auth-github] selected session email', {
              selectedEmail: maskEmail(user.email),
              verifiedDomains: emailDomains(verifiedEmails),
              verifiedCount: verifiedEmails.length,
              selectedAgileEngine: !!agileEngineEmail,
            })
          }
        } else {
          const body = await res.text().catch(() => '')
          console.warn('[auth-github] /user/emails failed', {
            status: res.status,
            statusText: res.statusText,
            oauthScopes: res.headers.get('x-oauth-scopes'),
            acceptedOauthScopes: res.headers.get('x-accepted-oauth-scopes'),
            rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
            rateLimitReset: res.headers.get('x-ratelimit-reset'),
            body: truncateLogValue(body),
          })
        }
      } catch (err) {
        console.warn('GitHub email lookup failed:', err?.message || err)
      }

      if (!user.email && profile?.email) user.email = profile.email
      console.info('[auth-github] signIn final user', {
        finalEmail: maskEmail(user?.email),
        emailListCount: Array.isArray(user?.emails) ? user.emails.length : 0,
        emailDomains: emailDomains(user?.emails),
      })
      user.profile = profile
      return true
    },
    jwt: async ({ token, user }) => {
      if (user) {
        console.info('[auth-github] jwt store user', {
          email: maskEmail(user?.email),
          emailListCount: Array.isArray(user?.emails) ? user.emails.length : 0,
          emailDomains: emailDomains(user?.emails),
        })
        token.user = user
      }
      return token
    },
    session: async ({ session, token }) => {
      if (token?.user) session.user = token.user
      return session
    }
  },

  theme: 'light',

  debug: false,
})
