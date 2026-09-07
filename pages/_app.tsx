// @ts-nocheck
import '../styles/globals.css'
import * as gtag from '../lib/gtag'
import { useEffect } from 'react'
import Script from 'next/script'
import { useRouter } from 'next/router'
import { SessionProvider } from "next-auth/react"
import { Analytics } from '@vercel/analytics/react';
import { ThemeProvider } from "next-themes"
import { installClientErrorReporter } from '../lib/clientErrorReporter'

function App({ Component, pageProps: { session, ...pageProps } }) {
  const router = useRouter()
  const isSandbox = router.pathname === '/sandbox/[id]'

  // Hooks must run unconditionally, so the sandbox early-return comes after them.
  useEffect(() => {
    if (isSandbox) return
    installClientErrorReporter()
  }, [isSandbox])

  // Exclude sandbox from any additional scripts / providers
  if (isSandbox) {
    return (
      <Component {...pageProps} />
    )
  }

  return (
    <>
      {/* Global Site Tag (gtag.js) - Google Analytics */}
      {/*<Script*/}
      {/*  strategy="afterInteractive"*/}
      {/*  src={`https://www.googletagmanager.com/gtag/js?id=${gtag.GA_TRACKING_ID}`}*/}
      {/*/>*/}
      {/*<Script*/}
      {/*  id="gtag-init"*/}
      {/*  strategy="afterInteractive"*/}
      {/*  dangerouslySetInnerHTML={{*/}
      {/*    __html: `*/}
      {/*      window.dataLayer = window.dataLayer || [];*/}
      {/*      function gtag(){dataLayer.push(arguments);}*/}
      {/*      gtag('js', new Date());*/}
      {/*      gtag('config', '${gtag.GA_TRACKING_ID}', {*/}
      {/*        page_path: window.location.pathname,*/}
      {/*      });*/}
      {/*    `,*/}
      {/*  }}*/}
      {/*/>*/}

      <SessionProvider session={session}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Component {...pageProps} />
        </ThemeProvider>
      </SessionProvider>
      <Analytics />
    </>
  )
}

export default App
