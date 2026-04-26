// @ts-nocheck
import {codeLanguageClass, highlightSanitizedCode} from '../utils/hljs'
import { formatNumber, formatLatency } from '../utils/ArrayUtils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function MetricTooltip({ children, text }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

export default function Test(props) {
  const {
    title, code, error, status,
    hz, rme, fastest, slowest, percent, tied,
    elapsed, total, opsPerSec,
    samples, meanLatency, p99Latency, p50Latency,
  } = props.test
  const language = props.language || 'javascript'

  const progressPct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0

  const result = {
    default: (<div className="text-muted-foreground text-sm">ready</div>),
    pending: (<div className="text-muted-foreground text-sm">pending…</div>),
    running: (
      <div>
        <div className="w-full bg-secondary rounded-full h-1.5 my-1.5 overflow-hidden">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-200"
            style={{width: `${progressPct}%`}}
          />
        </div>
        <p className="text-xs text-muted-foreground leading-tight">
          {opsPerSec > 0
            ? `~${formatNumber(Math.round(opsPerSec))} ops/s`
            : 'warming up…'}
        </p>
        <p className="text-[10px] text-muted-foreground">{progressPct}%</p>
      </div>
    ),
    completed: (<div className="text-muted-foreground text-sm">completed</div>),
    error: (<div className="font-bold text-destructive">ERROR</div>),
    finished: (
      <>
        <MetricTooltip text="Operations per second: how many times this test ran each second. Higher is faster.">
          <p className="font-semibold text-foreground cursor-help" tabIndex={0}>
            {hz != null && hz !== '' ? hz : '—'}
          </p>
        </MetricTooltip>
        <MetricTooltip text="Relative margin of error. Lower means the result was steadier during sampling.">
          <small className="block text-muted-foreground cursor-help" tabIndex={0}>
            {rme === '—' || rme === 'n/a' ? rme : `±${rme}%`}
          </small>
        </MetricTooltip>
        <p className="text-sm font-medium">
          {tied
            ? 'tied'
            : fastest
              ? <span className="text-green-600 dark:text-green-500">fastest</span>
              : percent === '—'
                ? '—'
                : `${percent}% slower`}
        </p>
        {samples > 0 && (
          <MetricTooltip text={`Samples are timing windows. Mean: average run time. p50: typical run (${formatLatency(p50Latency)}). p99: slow tail, 99% of runs were faster than ${formatLatency(p99Latency)}.`}>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight cursor-help" tabIndex={0}>
              {samples} samples · {formatLatency(meanLatency)}
            </p>
          </MetricTooltip>
        )}
      </>
    )
  }

  let rowBg = "bg-card"
  if (status === 'finished' && fastest && !tied) rowBg = "bg-green-500/10"
  if (status === 'finished' && slowest && !tied) rowBg = "bg-red-500/10"
  if (status === 'error') rowBg = "bg-destructive/10"

  return (
    <tr className={`border-b border-border ${rowBg} transition-colors`}>
      <td className="py-4 px-4 bg-muted/50 w-1/5 border-r border-border font-medium align-top">
        {title}
      </td>
      <td className="py-4 px-4 border-r border-border align-top">
        <pre className="w-full whitespace-pre-wrap break-words">
          <code className={`${codeLanguageClass(language, code)} text-sm font-mono text-muted-foreground`} dangerouslySetInnerHTML={
            {__html: highlightSanitizedCode(code, language)}} />
        </pre>
        {status === 'error' && error && (
          <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded text-xs font-mono text-destructive whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
        {props.stats && props.stats.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border flex flex-col gap-2 text-xs text-muted-foreground">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5 shrink-0 pt-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Community Stats:
              </span>
              <div className="flex flex-col gap-1.5">
                {props.stats.slice(0, 3).map((s, idx) => (
                  <span key={idx} className="bg-muted px-2 py-1 rounded inline-flex items-baseline gap-1 whitespace-nowrap w-fit">
                    <strong className="text-foreground">{s.browserName}</strong> <span className="opacity-75 text-[10px]">on {s.osName || 'unknown'}</span>
                    {s.cpuArch && s.cpuArch !== 'unknown' ? ` (${s.cpuArch})` : ''} <span className="mx-1 opacity-40">•</span> ~{formatNumber(Math.round(s.avgOps))} ops/s <span className="opacity-50 text-[10px] ml-1">({s.count} runs)</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </td>
      <td className="py-4 px-4 text-center w-[160px] align-top">
        {result[status] || result.default}
      </td>
    </tr>
  )
}
