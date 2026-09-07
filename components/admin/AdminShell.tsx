import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/router'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, ChevronRight, LayoutDashboard, LogOut, Moon, ShieldBan, Sun, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import SEO from '../SEO'
import { Avatar } from './primitives'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import logoSmall from '../../public/logo-small-transparent.png'

type NavItem = { href: string; label: string; icon: LucideIcon; match: (pathname: string) => boolean }

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, match: (p) => p === '/admin' },
  { href: '/admin/users', label: 'Users', icon: Users, match: (p) => p.startsWith('/admin/users') },
  { href: '/admin/ip-bans', label: 'IP bans', icon: ShieldBan, match: (p) => p.startsWith('/admin/ip-bans') },
  { href: '/admin/errors', label: 'Errors', icon: AlertTriangle, match: (p) => p.startsWith('/admin/errors') },
]

export type Breadcrumb = { label: string; href?: string }

type AdminShellProps = {
  title: string
  description?: ReactNode
  breadcrumbs?: Breadcrumb[]
  actions?: ReactNode
  children: ReactNode
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <span className="size-8" aria-hidden="true" />
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}

function NavLinks({ pathname, className, itemClassName }: { pathname: string; className?: string; itemClassName?: string }) {
  return (
    <ul className={className}>
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname)
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:no-underline',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                itemClassName,
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 hover:no-underline">
      <Image src={logoSmall} alt="" className="h-7 w-auto object-contain dark:[filter:invert(1)_hue-rotate(180deg)]" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-tight">Admin</span>
    </Link>
  )
}

export default function AdminShell({ title, description, breadcrumbs, actions, children }: AdminShellProps) {
  const { pathname } = useRouter()
  const { data: session } = useSession()
  const sessionUser = session?.user as { name?: string | null; image?: string | null; profile?: { login?: string } } | undefined
  const login = sessionUser?.profile?.login || sessionUser?.name || 'admin'

  return (
    <>
      <SEO title={`${title} · Admin`} description="jsPerf admin panel" canonical="/admin" ogImage="/og-image.png" noindex />

      <div className="min-h-screen bg-background text-foreground">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar">
          <div className="flex h-14 items-center border-b border-sidebar-border px-5">
            <Brand />
          </div>
          <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 py-4">
            <NavLinks pathname={pathname} className="space-y-1" />
          </nav>
          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-3 px-2 py-1.5">
              <Avatar src={sessionUser?.image} alt={login} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{login}</div>
                <div className="text-xs text-muted-foreground">Administrator</div>
              </div>
              <ThemeToggle />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <Button asChild variant="ghost" size="sm" className="justify-start text-muted-foreground">
                <Link href="/"><ArrowUpRight className="h-4 w-4" /> Site</Link>
              </Button>
              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => signOut({ callbackUrl: '/' })}>
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
        </aside>

        {/* Top bar (mobile / tablet) */}
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button asChild variant="ghost" size="icon-sm" aria-label="Back to site">
                <Link href="/"><ArrowUpRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
          <nav aria-label="Admin sections" className="overflow-x-auto px-2 pb-2">
            <NavLinks pathname={pathname} className="flex gap-1" itemClassName="whitespace-nowrap" />
          </nav>
        </header>

        <main className="lg:pl-60">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                {breadcrumbs && breadcrumbs.length > 0 && (
                  <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {breadcrumbs.map((crumb, index) => (
                      <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                        {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                        {crumb.href ? <Link href={crumb.href} className="hover:text-foreground">{crumb.label}</Link> : <span>{crumb.label}</span>}
                      </span>
                    ))}
                  </nav>
                )}
                <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
            </div>

            {children}
          </div>
        </main>
      </div>
    </>
  )
}
