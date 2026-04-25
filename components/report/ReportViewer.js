/**
 * Self-contained slide-deck viewer for a single report.
 *
 * Renders one full-bleed slide at a time with keyboard / button
 * navigation, a thumbnail strip, and copy/share/print affordances.
 * Designed to be opened in a new tab and projected as-is, so we keep
 * the global header/footer out — the host page renders this directly
 * inside <main>.
 */
import React, { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Share2,
  Copy,
  Check,
  Presentation,
  ExternalLink,
} from 'lucide-react'
import { SLIDE_COMPONENTS, SLIDE_LABELS } from './Slides'
import { buildDeck } from './slideUtils'
import MobileReportViewer from './MobileReportViewer'
import SlideProgress from './SlideProgress'

export default function ReportViewer({ report }) {
  const deck = buildDeck(report)
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [shareUrl, setShareUrl] = useState('')
  const { resolvedTheme } = useTheme()

  // The viewer page bypasses <Layout>, so we inject the highlight.js
  // theme stylesheet here (same CDN URL Layout uses) to make code
  // blocks on slides render with proper syntax colors.
  //
  // We always inject TWO sheets: one scoped to `media="screen"` (which
  // follows the user's chosen theme) and one scoped to `media="print"`
  // (which is always the light theme so PDFs read well on white).
  // Loading both up-front avoids a network race when the browser fires
  // beforeprint — without it, the first Cmd+P prints with the dark
  // theme on a light pre, hiding most of the highlighted code in the
  // PDF.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const lightUrl = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.2.0/styles/github.min.css'
    const darkUrl = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.2.0/styles/github-dark.min.css'
    const wantLight = resolvedTheme === 'light'

    const ensureLink = (id, href, media) => {
      let link = document.getElementById(id)
      if (!link) {
        link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      if (link.media !== media) link.media = media
      if (link.href !== href) link.href = href
    }

    ensureLink('hljs-theme-screen', wantLight ? lightUrl : darkUrl, 'screen')
    ensureLink('hljs-theme-print', lightUrl, 'print')
  }, [resolvedTheme])

  // Force light mode for the duration of a print job. Without this,
  // dark-mode users get white-on-white slides because browsers strip
  // dark page backgrounds in print but Tailwind's `dark:text-*` rules
  // keep emitting bright text. The hljs theme is handled separately
  // via media-scoped <link> tags above, so it doesn't need a swap here.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let wasDark = false
    const before = () => {
      wasDark = document.documentElement.classList.contains('dark')
      if (wasDark) document.documentElement.classList.remove('dark')
    }
    const after = () => {
      if (wasDark) document.documentElement.classList.add('dark')
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  // Compute the absolute share URL on mount — we can't render it
  // server-side because we don't know the host.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(`${window.location.origin}/r/${report.id}`)
    }
  }, [report.id])

  const slideKey = deck[index]
  const SlideComponent = SLIDE_COMPONENTS[slideKey]

  const goPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => setIndex(i => Math.min(deck.length - 1, i + 1)), [deck.length])

  // Keyboard navigation: ←/→/Space, Home/End, F for fullscreen.
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          goPrev(); e.preventDefault(); break
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          goNext(); e.preventDefault(); break
        case 'Home':
          setIndex(0); e.preventDefault(); break
        case 'End':
          setIndex(deck.length - 1); e.preventDefault(); break
        case 'f':
        case 'F':
          toggleFullscreen(); break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext, deck.length])

  // Fullscreen state mirroring — handles user-initiated escape.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Auto-hide the on-screen chevrons + slide counter while presenting.
  // Mirrors PowerPoint/Keynote: chrome reappears on mouse move and
  // fades out again after ~2s of stillness. Only active in fullscreen
  // so the windowed viewer keeps its always-visible controls.
  useEffect(() => {
    if (!isFullscreen) {
      setChromeVisible(true)
      return
    }
    let timer
    const reveal = () => {
      setChromeVisible(true)
      clearTimeout(timer)
      timer = setTimeout(() => setChromeVisible(false), 2000)
    }
    reveal()
    window.addEventListener('mousemove', reveal)
    window.addEventListener('keydown', reveal)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', reveal)
      window.removeEventListener('keydown', reveal)
    }
  }, [isFullscreen])

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      document.documentElement.requestFullscreen?.()
    }
  }, [])

  const onCopyLink = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {
      // Older browsers or permission errors — fall through silently.
    }
  }, [shareUrl])

  const onShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.share || !shareUrl) {
      onCopyLink()
      return
    }
    try {
      await navigator.share({ title: report.title, url: shareUrl })
    } catch (_) {
      // User cancelled — no-op.
    }
  }, [shareUrl, report.title, onCopyLink])

  const onPrint = useCallback(() => window.print(), [])

  if (!SlideComponent) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        This report has no slides to show.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-foreground flex flex-col">
      <Head>
        <title>{`${report.title} — jsPerf report`}</title>
        <meta name="description" content={`Performance report for "${report.title}" generated on jsperf.net`} />
        <meta property="og:title" content={`${report.title} — jsPerf report`} />
        <meta property="og:description" content="A presentation-ready performance report from jsperf.net" />
      </Head>

      <style jsx global>{`
        /* Off-screen during normal use: stack is fully laid out at
           print size so charts measure correctly, but invisible to
           the presenter. ResponsiveContainer needs a real size on
           mount or it paints empty SVGs. */
        @media screen {
          .report-print-stack {
            position: fixed;
            left: -100000px;
            top: 0;
            width: 1280px;
            pointer-events: none;
          }
          .report-print-page {
            width: 1280px;
            height: 720px;
            overflow: hidden;
          }
        }

        @media print {
          @page { size: 1280px 720px; margin: 0; }

          /* Force the light shadcn palette onto the document during
             print, regardless of whether the user's site is in dark
             mode. The JS handler also removes the .dark class from
             <html> as a primary mechanism, but this CSS rule is the
             belt-and-suspenders that works even if beforeprint never
             fires (Safari, headless tools, etc.). The values must
             match styles/globals.css exactly — those are OKLCH in
             Tailwind v4, NOT HSL. */
          html, html.dark, .report-print-stack, .report-print-page {
            --background: oklch(1 0 0) !important;
            --foreground: oklch(0.145 0 0) !important;
            --card: oklch(1 0 0) !important;
            --card-foreground: oklch(0.145 0 0) !important;
            --popover: oklch(1 0 0) !important;
            --popover-foreground: oklch(0.145 0 0) !important;
            --primary: oklch(0.205 0 0) !important;
            --primary-foreground: oklch(0.985 0 0) !important;
            --secondary: oklch(0.97 0 0) !important;
            --secondary-foreground: oklch(0.205 0 0) !important;
            --muted: oklch(0.97 0 0) !important;
            --muted-foreground: oklch(0.556 0 0) !important;
            --accent: oklch(0.97 0 0) !important;
            --accent-foreground: oklch(0.205 0 0) !important;
            --border: oklch(0.922 0 0) !important;
            color-scheme: light !important;
          }

          html, body {
            background: #fff !important;
            color: #0f172a !important;
          }

          /* Hide everything except the print stack, then restore it
             into the visible flow, one page per slide. */
          body > * { visibility: hidden !important; }
          .report-print-stack,
          .report-print-stack * { visibility: visible !important; }
          .report-print-stack {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 1280px !important;
          }

          .report-print-page {
            position: relative !important;
            width: 1280px !important;
            height: 720px !important;
            overflow: hidden !important;
            page-break-after: always;
            break-after: page;
            background: #fff !important;
            color: #0f172a !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .report-print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .report-print-page,
          .report-print-page * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Defensive overrides for the few dark: utility classes the
             slides use that wouldn't get neutralised by removing the
             .dark class (e.g. when print fires before the class flip
             takes effect, or when the browser doesn't fire beforeprint
             at all). These match the exact Tailwind class names so
             specificity beats the dark variant. */
          .report-print-stack [class*="dark:bg-slate-900/70"] {
            background-color: rgb(255 255 255 / 0.7) !important;
          }
          .report-print-stack [class*="dark:bg-slate-900"]:not([class*="dark:bg-slate-900/"]) {
            background-color: #ffffff !important;
          }
          .report-print-stack [class*="dark:bg-slate-800"] {
            background-color: #e2e8f0 !important;
          }
          .report-print-stack [class*="dark:from-emerald-950"] {
            background-image: linear-gradient(to bottom right, #ecfdf5, #ffffff, #ecfdf5) !important;
          }
          .report-print-stack [class*="dark:from-violet-950"] {
            background-image: linear-gradient(to bottom right, #f5f3ff, #ffffff, #fff1f2) !important;
          }
          .report-print-stack [class*="dark:from-sky-950"] {
            background-image: linear-gradient(to bottom right, #f0f9ff, #ffffff, #eef2ff) !important;
          }
          .report-print-stack [class*="dark:to-cyan-950"] {
            background-image: linear-gradient(to bottom right, #f0f9ff, #ffffff, #ecfeff) !important;
          }
          .report-print-stack [class*="dark:bg-amber-950"] {
            background-color: rgb(254 252 232 / 0.7) !important;
          }

          /* Tinted card backgrounds used by the Insight, Methodology,
             Winner and Head-to-head slides. Without these the cards
             land as white-on-white in the PDF and the slide reads as
             empty even though the text is technically there. */
          .report-print-stack [class*="dark:bg-violet-950/30"]:not([class*="from-"]) {
            background-color: rgb(245 243 255 / 0.8) !important;
          }
          .report-print-stack [class*="dark:bg-emerald-950/30"]:not([class*="from-"]) {
            background-color: rgb(236 253 245 / 0.8) !important;
          }
          .report-print-stack [class*="dark:bg-sky-950/30"]:not([class*="from-"]) {
            background-color: rgb(240 249 255 / 0.8) !important;
          }
          .report-print-stack [class*="dark:bg-indigo-950/30"]:not([class*="from-"]) {
            background-color: rgb(238 242 255 / 0.6) !important;
          }
          .report-print-stack [class*="dark:bg-cyan-950/30"]:not([class*="from-"]) {
            background-color: rgb(236 254 255 / 0.7) !important;
          }
          .report-print-stack [class*="dark:bg-rose-950/30"]:not([class*="from-"]) {
            background-color: rgb(255 241 242 / 0.8) !important;
          }
          .report-print-stack [class*="dark:bg-amber-950/20"]:not([class*="from-"]) {
            background-color: rgb(254 252 232 / 0.7) !important;
          }
          .report-print-stack [class*="dark:from-rose-950"] {
            background-image: linear-gradient(to bottom right, #ecfdf5, #ffffff, #fff1f2) !important;
          }
        }
      `}</style>

      {/* Mobile: a clean vertical scroll instead of a 16:9 stage. */}
      <div className="md:hidden print:hidden">
        <MobileReportViewer
          report={report}
          shareUrl={shareUrl}
          copied={copied}
          onCopyLink={onCopyLink}
          onShare={onShare}
        />
      </div>

      {/* Desktop / tablet: the slide-deck viewer. */}
      <div
        className={`hidden md:flex md:flex-col md:flex-1 print:hidden ${
          isFullscreen ? 'bg-black' : ''
        }`}
      >

      {/* Top toolbar — hidden while presenting so the slide is the
          only thing on screen. */}
      <div
        className={`${
          isFullscreen ? 'hidden' : 'flex'
        } items-center gap-2 px-3 sm:px-5 py-3 border-b bg-white/80 dark:bg-slate-900/60 backdrop-blur sticky top-0 z-20`}
      >
        <Link href="/" className="flex items-center gap-2 font-semibold text-sm hover:opacity-80">
          <Presentation className="h-4 w-4 text-violet-600" />
          <span>jsPerf report</span>
        </Link>
        <div className="hidden sm:block h-5 w-px bg-border mx-2" />
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <span className="truncate font-medium text-foreground">{report.title}</span>
          <Link
            href={`/${report.slug}${report.revision > 1 ? `/${report.revision}` : ''}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            source <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopyLink}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            aria-label="Copy share link"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            aria-label="Share"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            <span className="hidden lg:inline">{isFullscreen ? 'Exit' : 'Present'}</span>
          </button>
        </div>
      </div>

      {/* On screen: a single 16:9 stage with the active slide.
          In fullscreen we drop padding/border/shadow and let the
          stage fill the viewport (letterboxed by aspect-ratio so
          the slide stays 16:9 regardless of the screen shape). */}
      <div
        className={`flex-1 flex items-center justify-center ${
          isFullscreen ? 'p-0' : 'p-3 sm:p-6'
        }`}
      >
        <div
          className={`relative w-full aspect-[16/9] bg-white dark:bg-slate-900 text-foreground overflow-hidden ${
            isFullscreen
              ? 'max-h-screen'
              : 'max-w-[1280px] rounded-2xl shadow-xl border'
          } ${isFullscreen && !chromeVisible ? 'cursor-none' : ''}`}
          role="region"
          aria-label={`Slide ${index + 1} of ${deck.length}`}
        >
          <SlideComponent report={report} />

          <button
            type="button"
            onClick={goPrev}
            disabled={index === 0}
            className={`absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-sm transition-opacity duration-300 ${
              isFullscreen && !chromeVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={index === deck.length - 1}
            className={`absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-sm transition-opacity duration-300 ${
              isFullscreen && !chromeVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            aria-label="Next slide"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Dot progress only appears in fullscreen — the labeled
              thumbnail strip below the stage already serves as the
              navigator in windowed mode. */}
          {isFullscreen && (
            <SlideProgress
              deck={deck}
              index={index}
              onSelect={setIndex}
              labels={SLIDE_LABELS}
              className={`absolute bottom-3 left-1/2 -translate-x-1/2 transition-opacity duration-300 ${
                chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          )}
        </div>
      </div>

      {/* Thumbnail strip (desktop) — hidden in fullscreen so the
          slide owns the screen during a presentation. */}
      <div
        className={`${
          isFullscreen ? 'hidden' : 'block'
        } border-t bg-white/80 dark:bg-slate-900/60 backdrop-blur px-3 sm:px-5 py-3 overflow-x-auto`}
      >
        <div className="flex items-center gap-2 min-w-max">
          {deck.map((key, i) => (
            <button
              key={key + i}
              type="button"
              onClick={() => setIndex(i)}
              className={`group relative flex-shrink-0 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                i === index
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-900 dark:text-violet-100'
                  : 'border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
              aria-label={`Go to slide ${i + 1}: ${SLIDE_LABELS[key] || key}`}
            >
              <span className="text-[10px] uppercase tracking-wider opacity-60 mr-2">{i + 1}</span>
              {SLIDE_LABELS[key] || key}
            </button>
          ))}
          <button
            type="button"
            onClick={onPrint}
            className="ml-2 flex-shrink-0 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            Print / PDF
          </button>
        </div>
      </div>

      </div>{/* /desktop wrapper */}

      {/* The print stack — rendered ALL THE TIME (at every breakpoint)
          but moved off-screen while presenting. We can't use
          `display:none` here: Recharts' ResponsiveContainer relies on
          a measured layout (it uses a ResizeObserver on its parent),
          and a hidden parent reports a 0×0 size, leaving the SVGs
          blank in the PDF. By laying it out at the real 1280×720 print
          size off-screen, every chart is fully measured and painted
          by the time the user hits Print, so the PDF captures them
          correctly. Lives outside the desktop wrapper so mobile users
          can still print. */}
      <div className="report-print-stack" aria-hidden>
        {deck.map((key, i) => {
          const Cmp = SLIDE_COMPONENTS[key]
          if (!Cmp) return null
          return (
            <div
              key={`print-${key}-${i}`}
              className="report-print-page bg-white text-slate-900"
            >
              <Cmp report={report} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
