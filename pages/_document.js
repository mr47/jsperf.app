import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" href="/favicon.ico" />
        {/* Open Graph default image could go here, but usually defined per-page or in _app */}
      </Head>
      <body className="min-h-screen bg-background font-sans antialiased text-foreground">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
