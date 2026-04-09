import { signOut, useSession } from "next-auth/react"
import Link from 'next/link'

export default function Footer() {
  const { data: session, status } = useSession()

  return (
      <footer className="mt-8 block overflow-hidden border-t border-border">
        <nav className="container flex flex-wrap items-center justify-between px-2 py-4">
          <div className="flex gap-4 mb-4 sm:mb-0">
            <Link href="/" className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors">
              New Benchmark
            </Link>
            <Link href="https://github.com/mr47/jsperf.app/issues" className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors">
              Report Issue
            </Link>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              Built by <a href="https://mr47.in" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-primary transition-colors">Dmytro Piddubnyi</a>
            </span>
            {session && (
              <a href="#" className="font-medium hover:text-foreground transition-colors" onClick={(e) => { e.preventDefault(); signOut(); }}>
                Sign Out
              </a>
            )}
          </div>
        </nav>
      </footer>
  )
}
