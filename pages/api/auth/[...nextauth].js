import NextAuth from "next-auth"
import GitHubProvider from "next-auth/providers/github"

export default NextAuth({
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET
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
            Authorization: `token ${account.access_token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'jsperf.net',
          },
        })
        if (res.ok) {
          const emails = await res.json().catch(() => null)
          if (Array.isArray(emails) && emails.length > 0) {
            const primary = [...emails].sort((a, b) =>
              (b?.primary === true) - (a?.primary === true)
            )[0]
            if (primary?.email) user.email = primary.email
          }
        } else {
          console.warn('GitHub /user/emails returned', res.status)
        }
      } catch (err) {
        console.warn('GitHub email lookup failed:', err?.message || err)
      }

      if (!user.email && profile?.email) user.email = profile.email
      user.profile = profile
      return true
    },
    jwt: async ({ token, user }) => {
      if (user) token.user = user
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
