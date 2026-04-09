import {highlightSanitizedJS} from '../utils/hljs'
import { formatNumber, formatLatency } from '../utils/ArrayUtils'

export default function Test(props) {
  const {
    title, code, error, status,
    hz, rme, fastest, slowest, percent, tied,
    elapsed, total, opsPerSec,
    samples, meanLatency, p99Latency, p50Latency,
  } = props.test

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
        <p className="font-semibold text-foreground">{hz != null && hz !== '' ? hz : '—'}</p>
        <small className="block text-muted-foreground">
          {rme === '—' || rme === 'n/a' ? rme : `±${rme}%`}
        </small>
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
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight" title={`p50: ${formatLatency(p50Latency)} · p99: ${formatLatency(p99Latency)}`}>
            {samples} samples · {formatLatency(meanLatency)}
          </p>
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
          <code className="text-sm font-mono text-muted-foreground" dangerouslySetInnerHTML={
            {__html: highlightSanitizedJS(code)}} />
        </pre>
      </td>
      <td className="py-4 px-4 text-center w-[160px] align-top">
        {result[status] || result.default}
      </td>
    </tr>
  )
}
