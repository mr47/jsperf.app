// @ts-nocheck
import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Shown when /sandbox/[id] is opened in a top-level tab. The interactive runner
 * (Run / results) lives on the benchmark page, which embeds this URL in an iframe.
 */
export default function SandboxBanner({ pageData }) {
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    setStandalone(typeof window !== 'undefined' && window.parent === window)
  }, [])

  if (!standalone || !pageData?.slug) {
    return null
  }

  const { slug, revision = 1 } = pageData
  const href = revision === 1 ? `/${slug}` : `/${slug}/${revision}`

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-3 text-sm text-amber-950">
      <p className="font-semibold">This URL is the iframe sandbox only.</p>
      <p className="mt-1">
        Open the benchmark page to use the test runner and see results:{' '}
        <Link href={href} className="underline font-medium text-amber-900">
          {href}
        </Link>
      </p>
    </div>
  )
}
