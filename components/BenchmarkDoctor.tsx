import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldAlert, Stethoscope, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SEVERITY_STYLES = {
  danger: {
    row: 'border-red-200/70 bg-red-50/45 dark:border-red-800/60 dark:bg-red-950/20',
    icon: 'text-red-600 dark:text-red-400',
    pill: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  },
  warning: {
    row: 'border-amber-200/70 bg-amber-50/45 dark:border-amber-800/60 dark:bg-amber-950/20',
    icon: 'text-amber-600 dark:text-amber-400',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  info: {
    row: 'border-border/60 bg-muted/20',
    icon: 'text-violet-500',
    pill: 'bg-muted text-muted-foreground',
  },
}

const SEVERITY_LABELS = {
  danger: 'High risk',
  warning: 'Review',
  info: 'Note',
}

export default function BenchmarkDoctor({ doctor }) {
  const [selectedGroup, setSelectedGroup] = useState(null)
  const diagnostics = Array.isArray(doctor?.diagnostics) ? doctor.diagnostics : []
  const groupedDiagnostics = useMemo(() => groupDiagnostics(diagnostics), [diagnostics])

  if (!doctor) return null

  const summary = doctor?.summary || {}
  const hasDanger = summary.danger > 0
  const isClean = diagnostics.length === 0
  const title = isClean
    ? 'Benchmark looks healthy'
    : hasDanger
      ? 'Results may be misleading'
      : 'Review before trusting the winner'
  const description = isClean
    ? 'No common benchmark traps were detected.'
    : 'Grouped checks that can skew the ops/sec winner.'
  const shellClass = isClean
    ? 'border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/30 dark:bg-emerald-950/10'
    : 'border-amber-200/70 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10'
  const iconShellClass = isClean
    ? 'bg-emerald-100 dark:bg-emerald-900/40'
    : 'bg-amber-100 dark:bg-amber-900/40'
  const Icon = isClean ? CheckCircle2 : Stethoscope
  const iconClass = isClean
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-amber-700 dark:text-amber-300'

  return (
    <div className={`rounded-xl border p-4 ${shellClass}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconShellClass}`}>
          <Icon className={`h-4 w-4 ${iconClass}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {diagnostics.length} {diagnostics.length === 1 ? 'finding' : 'findings'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>

            {!isClean && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="bg-background/70"
                onClick={() => setSelectedGroup({
                  title: 'Benchmark Doctor details',
                  diagnostics,
                })}
              >
                Explain
              </Button>
            )}
          </div>

          {isClean ? (
            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
              No dead-code, constant-folding, async, browser-runtime, or variance warnings showed up.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {groupedDiagnostics.slice(0, 4).map((group) => (
                <DoctorFindingGroup
                  key={group.key}
                  group={group}
                  onExplain={() => setSelectedGroup(group)}
                />
              ))}
            </div>
          )}

          {groupedDiagnostics.length > 4 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing the top {Math.min(groupedDiagnostics.length, 4)} issue groups. Open details for the full list.
            </p>
          )}
        </div>
      </div>

      <DoctorDetailsModal
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
      />
    </div>
  )
}

function DoctorFindingGroup({ group, onExplain }) {
  const styles = SEVERITY_STYLES[group.severity] || SEVERITY_STYLES.info
  const Icon = group.severity === 'danger' ? ShieldAlert : AlertTriangle
  const tests = formatAffectedTests(group.diagnostics)

  return (
    <div className={`rounded-lg border px-3 py-2 ${styles.row}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${styles.icon}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-semibold text-foreground">{group.title}</p>
            {group.count > 1 && (
              <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {group.count} findings
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles.pill}`}>
              {SEVERITY_LABELS[group.severity] || group.severity}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{tests}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 px-2 text-[11px]"
          onClick={onExplain}
        >
          Details
        </Button>
      </div>
    </div>
  )
}

function DoctorDetailsModal({ group, onClose }) {
  useEffect(() => {
    if (!group) return

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [group, onClose])

  if (!group) return null

  const diagnostics = group.diagnostics || []

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmark-doctor-details-title"
        className="max-h-[88vh] w-full overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Benchmark Doctor
            </p>
            <h3 id="benchmark-doctor-details-title" className="mt-1 text-base font-semibold text-foreground">
              {group.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {diagnostics.length} {diagnostics.length === 1 ? 'finding' : 'findings'} with the evidence and fix guidance.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="Close Benchmark Doctor details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(88vh-8rem)] overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            {diagnostics.map((diagnostic) => (
              <DoctorDetail key={diagnostic.id} diagnostic={diagnostic} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function DoctorDetail({ diagnostic }) {
  const styles = SEVERITY_STYLES[diagnostic.severity] || SEVERITY_STYLES.info

  return (
    <div className={`rounded-xl border p-3 ${styles.row}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles.pill}`}>
          {SEVERITY_LABELS[diagnostic.severity] || diagnostic.severity}
        </span>
        {diagnostic.testTitle && (
          <span className="text-xs font-medium text-muted-foreground">{diagnostic.testTitle}</span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{diagnostic.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{diagnostic.message}</p>
      {diagnostic.evidence && (
        <p className="mt-2 rounded-md bg-background/65 px-2 py-1.5 text-[11px] text-muted-foreground">
          Evidence: <span className="font-mono text-foreground/80">{diagnostic.evidence}</span>
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-foreground/80">{diagnostic.recommendation}</p>
    </div>
  )
}

function groupDiagnostics(diagnostics) {
  const groups = new Map()

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}:${diagnostic.category}:${diagnostic.title}`
    const existing = groups.get(key)

    if (existing) {
      existing.count += 1
      existing.diagnostics.push(diagnostic)
    } else {
      groups.set(key, {
        key,
        title: diagnostic.title,
        severity: diagnostic.severity,
        count: 1,
        diagnostics: [diagnostic],
      })
    }
  }

  return Array.from(groups.values())
}

function formatAffectedTests(diagnostics) {
  const titles = diagnostics
    .map(diagnostic => diagnostic.testTitle)
    .filter(Boolean)

  if (titles.length === 0) return 'Run-level check'

  const uniqueTitles = Array.from(new Set(titles))
  const shown = uniqueTitles.slice(0, 3).join(', ')
  const hidden = uniqueTitles.length - 3

  return hidden > 0 ? `${shown} + ${hidden} more` : shown
}
