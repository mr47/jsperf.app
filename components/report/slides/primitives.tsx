import React, { useMemo } from 'react'

import { codeLanguageClass, highlightSanitizedCode } from '../../../utils/hljs'

const TAG_PALETTE = {
  slate: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
}

export function SlideShell({ children, className = '', accent }) {
  return (
    <div className={`relative h-full w-full overflow-hidden p-6 sm:p-10 lg:p-16 flex flex-col ${className}`}>
      {accent && (
        <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-60" aria-hidden>
          <div
            className="absolute -top-32 -right-32 h-96 w-96 rounded-full blur-3xl"
            style={{ background: accent }}
          />
        </div>
      )}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {children}
      </div>
    </div>
  )
}

export function SlideHeader({ icon: Icon, eyebrow, title }) {
  return (
    <div className="mb-6 sm:mb-10">
      {eyebrow && (
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400">
          {Icon && <Icon className="h-4 w-4" />}
          <span>{eyebrow}</span>
        </div>
      )}
      {title && (
        <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
          {title}
        </h2>
      )}
    </div>
  )
}

/** Inline ribbon tag, used for "fastest" / "slowest" / runtime labels. */
export function Tag({ children, color = 'slate' }) {
  const palette = TAG_PALETTE[color] || TAG_PALETTE.slate
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${palette}`}>
      {children}
    </span>
  )
}

/**
 * Syntax-highlighted code block. Uses the project's existing hljs
 * helper (DOMPurify-sanitised) so the same JS-friendly subset and the
 * GitHub theme injected by ReportViewer apply uniformly across the
 * benchmark page and the report.
 *
 * The block stretches to fill its parent (`h-full w-full`), so a
 * three-line snippet doesn't float at the top of a tall column on
 * the Winner / HeadToHead slides — it sits in a properly-sized panel
 * with the code anchored at the top. `maxLines` still clips
 * pathologically long bodies so the panel can't push other slide
 * content off-screen.
 *
 * Print note: we deliberately use `overflow-hidden` (not `auto`)
 * because Chrome's print engine renders `overflow:auto` panes inside
 * deeply nested flex/grid layouts as a 0-height scroll viewport,
 * leaving the code panel blank in the PDF. The maxLines clipping
 * already guarantees the snippet fits, so a hard clip is safe.
 */
export function CodeBlock({ code, maxLines = 12, language = 'javascript' }) {
  const lines = (code || '').split('\n')
  const truncated = lines.length > maxLines
  const shown = truncated ? lines.slice(0, maxLines).join('\n') + '\n…' : (code || '')
  const html = useMemo(() => {
    try { return highlightSanitizedCode(shown, language) }
    catch (_) { return null }
  }, [shown, language])

  if (!shown.trim()) {
    return (
      <div className="h-full w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 text-xs text-muted-foreground italic flex items-center justify-center">
        No code captured for this test.
      </div>
    )
  }

  return (
    <pre className="block w-full h-full max-h-full overflow-hidden print:overflow-visible print:h-auto print:max-h-none rounded-lg text-xs sm:text-sm p-4 font-mono leading-relaxed border bg-[#f6f8fa] dark:bg-[#0d1117] border-slate-200 dark:border-slate-800 m-0 whitespace-pre">
      {html
        ? <code className={`${codeLanguageClass(language, shown)} block`} dangerouslySetInnerHTML={{ __html: html }} />
        : <code className={`${codeLanguageClass(language, shown)} block`}>{shown}</code>}
    </pre>
  )
}
