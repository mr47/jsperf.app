// @ts-nocheck
import { AlertTriangle, CheckCircle2, ShieldAlert, Stethoscope } from 'lucide-react'

const SEVERITY_STYLES = {
  danger: {
    row: 'border-red-200/70 bg-red-50/50 dark:border-red-800/60 dark:bg-red-950/20',
    icon: 'text-red-600 dark:text-red-400',
    pill: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  },
  warning: {
    row: 'border-amber-200/70 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20',
    icon: 'text-amber-600 dark:text-amber-400',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  info: {
    row: 'border-border/60 bg-muted/20',
    icon: 'text-violet-500',
    pill: 'bg-muted text-muted-foreground',
  },
}

export default function BenchmarkDoctor({ doctor }) {
  if (!doctor) return null

  const diagnostics = Array.isArray(doctor?.diagnostics) ? doctor.diagnostics : []

  const summary = doctor?.summary || {}
  const hasDanger = summary.danger > 0
  const isClean = diagnostics.length === 0
  const title = isClean
    ? 'Benchmark Doctor found no obvious issues'
    : hasDanger
      ? 'Benchmark Doctor found likely misleading results'
      : 'Benchmark Doctor found issues to review'
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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {diagnostics.length} {diagnostics.length === 1 ? 'finding' : 'findings'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These checks look for benchmark-shape problems that can make an ops/sec winner hard to trust.
          </p>

          {isClean ? (
            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
              No dead-code, constant-folding, async, browser-runtime, or variance warnings were detected for this analysis.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {diagnostics.slice(0, 6).map((diagnostic) => (
                <DoctorFinding key={diagnostic.id} diagnostic={diagnostic} />
              ))}
            </div>
          )}

          {diagnostics.length > 6 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing the first 6 findings. Fix those first, then re-run analysis to expose lower-priority issues.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DoctorFinding({ diagnostic }) {
  const styles = SEVERITY_STYLES[diagnostic.severity] || SEVERITY_STYLES.info
  const Icon = diagnostic.severity === 'danger' ? ShieldAlert : AlertTriangle

  return (
    <div className={`rounded-lg border px-3 py-2 ${styles.row}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${styles.icon}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-medium text-foreground">{diagnostic.title}</p>
            {diagnostic.testTitle && (
              <span className="text-[10px] text-muted-foreground">
                {diagnostic.testTitle}
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles.pill}`}>
              {diagnostic.severity}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{diagnostic.message}</p>
          {diagnostic.evidence && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              Evidence: <span className="font-mono">{diagnostic.evidence}</span>
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {diagnostic.recommendation}
          </p>
        </div>
      </div>
    </div>
  )
}
