import { signIn, useSession } from "next-auth/react"
import { useState, useEffect } from 'react'
import GitHubIcon from './GitHubIcon'
import Link from 'next/link'
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import DonorBoost from './DonorBoost'

export default function Header(props) {
  const { data: session, status } = useSession()
  const { navState: navStateInitial } = props
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  const [navState, setNavState] = useState({ "mobileMenu": false, ...navStateInitial});

  useEffect(() => {
    setMounted(true)
  }, [])

  const ToggleNavState = id => {
    navState[id] = !navState[id]
    setNavState({...navState});
  };

  const { login } = session?.user?.profile || {}
  const sessionLoading = status === 'loading'

  return (
    <header className="border-b border-border mb-6">
      <nav className="flex items-center justify-between flex-wrap py-4">
        <div className="flex items-center flex-shrink-0 mr-6">
          <Link href="/" className="no-underline text-foreground hover:text-foreground">
            <span className="sr-only">jsPerf Home Page</span>
            <span className="font-bold text-2xl tracking-tight">jsPerf.net</span>
          </Link>
        </div>
        <div className="block lg:hidden">
          <button className="flex items-center px-3 py-2 border rounded text-muted-foreground border-border hover:text-foreground hover:border-foreground" onClick={() => ToggleNavState('mobileMenu')}>
            <svg className="fill-current h-3 w-3" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><title>Menu</title><path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z"/></svg>
          </button>
        </div>
        <div className={`${navState.mobileMenu ? 'block' : 'hidden'} w-full flex-grow lg:flex lg:items-center lg:w-auto`}>
          <div className="text-sm lg:flex-grow flex gap-4 mt-4 lg:mt-0">
            <Link href="/latest" className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors flex items-center">
              Latest
            </Link>
            <Link href="/create" className="text-sm font-medium hover:text-foreground text-muted-foreground transition-colors flex items-center">
              Create
            </Link>
            <DonorBoost />
          </div>
          
          <div className="flex items-center gap-4 mt-4 lg:mt-0">
            {mounted ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
            ) : (
              <div className="size-9" aria-hidden="true" />
            )}
            
            <div className="flex min-w-24 max-w-40 justify-end">
              {sessionLoading ? (
                <div className="h-9 w-full" aria-hidden="true" />
              ) : !session ? (
                <Button variant="outline" onClick={() => signIn("github")} className="w-full flex items-center gap-2">
                  <span>Sign In</span>
                  <GitHubIcon fill="currentColor" width={16} height={16} />
                </Button>
              ) : (
                <Link href={`/u/${session?.user?.id}`} className="font-medium text-sm hover:text-primary transition-colors truncate text-right">
                  { login }
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>
    </header>
  )
}
