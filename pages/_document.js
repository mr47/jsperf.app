import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" href="/favicon.ico" />
        <script dangerouslySetInnerHTML={{
          __html: `
            try {
              if (window.origin === 'null') {
                Object.defineProperty(document, 'cookie', {
                  get: function() { return ''; },
                  set: function() {}
                });
                var originalReplaceState = history.replaceState;
                history.replaceState = function() {
                  try { return originalReplaceState.apply(history, arguments); } catch(e) {}
                };
                var originalPushState = history.pushState;
                history.pushState = function() {
                  try { return originalPushState.apply(history, arguments); } catch(e) {}
                };
                var storageMock = { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} };
                Object.defineProperty(window, 'localStorage', { value: storageMock });
                Object.defineProperty(window, 'sessionStorage', { value: storageMock });
              }
            } catch(e) {}
          `
        }} />
        {/* Open Graph default image could go here, but usually defined per-page or in _app */}
      </Head>
      <body className="min-h-screen bg-background font-sans antialiased text-foreground">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
