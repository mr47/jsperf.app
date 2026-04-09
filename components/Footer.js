import { signOut, useSession } from "next-auth/react"
import Link from 'next/link'

export default function Footer() {
  const { data: session, status } = useSession()

  return (
      <footer className="mt-8 block overflow-hidden border-t border-border">
        <nav className="container flex px-2 py-4">
          <div className="w-auto block flex-grow">
            <Link href="/" className="block mt-4 lg:inline-block lg:mt-0 mr-4 no-underline">
              New Benchmark
            </Link>
            <Link href="https://github.com/mr47/jsperf.app/issues" className="block mt-4 lg:inline-block lg:mt-0 mr-4 no-underline">
              Report Issue
            </Link>
          </div>
          <div>
            {
              session &&
                <a href="#" className="inline-block leading-none mt-4 lg:mt-0" onClick={() => signOut()}>Sign Out</a>
            }
          </div>
        </nav>
      </footer>
  )
}
