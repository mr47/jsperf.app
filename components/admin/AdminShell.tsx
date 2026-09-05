import Link from 'next/link'
import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import { AlertTriangle, LayoutDashboard, ShieldBan, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import SEO from '../SEO'
import Layout from '../Layout'
import { cn } from '@/lib/utils'

type NavItem = { href: string; label: string; icon: LucideIcon; match: (pathname: string) => boolean }

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, match: (p) => p === '/admin' },
  { href: '/admin/users', label: 'Users', icon: Users, match: (p) => p.startsWith('/admin/users') },
  { href: '/admin/ip-bans', label: 'IP bans', icon: ShieldBan, match: (p) => p.startsWith('/admin/ip-bans') },
  { href: '/admin/errors', label: 'Errors', icon: AlertTriangle, match: (p) => p.startsWith('/admin/errors') },
]

type AdminShellProps = {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

export default function AdminShell({ title, description, actions, children }: AdminShellProps) {
  const { pathname } = useRouter()

  return (
    <>
      <SEO title={`${title} · Admin`} description="jsPerf admin panel" canonical="/admin" ogImage="/og-image.png" noindex />
      <Layout>
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Admin</div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        <nav className="mb-6 -mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px" aria-label="Admin sections">
          {NAV.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors hover:text-foreground hover:no-underline',
                  active ? 'text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="pb-12">{children}</div>
      </Layout>
    </>
  )
}
