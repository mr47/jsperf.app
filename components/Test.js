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
    default: (<div className="text-gray-500 text-sm">ready</div>),
    pending: (<div className="text-gray-400 text-sm">pending…</div>),
    running: (
      <div>
        <div className="w-full bg-gray-200 rounded-full h-1.5 my-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
            style={{width: `${progressPct}%`}}
          />
        </div>
        <p className="text-xs text-gray-600 leading-tight">
          {opsPerSec > 0
            ? `~${formatNumber(Math.round(opsPerSec))} ops/s`
            : 'warming up…'}
        </p>
        <p className="text-[10px] text-gray-400">{progressPct}%</p>
      </div>
    ),
    completed: (<div className="text-gray-500 text-sm">completed</div>),
    error: (<div>ERROR</div>),
    finished: (
      <>
        <p className="font-semibold">{hz != null && hz !== '' ? hz : '—'}</p>
        <small className="block text-gray-600">
          {rme === '—' || rme === 'n/a' ? rme : `±${rme}%`}
        </small>
        <p className="text-sm">
          {tied
            ? 'tied'
            : fastest
              ? 'fastest'
              : percent === '—'
                ? '—'
                : `${percent}% slower`}
        </p>
        {samples > 0 && (
          <p className="text-[10px] text-gray-400 mt-1 leading-tight" title={`p50: ${formatLatency(p50Latency)} · p99: ${formatLatency(p99Latency)}`}>
            {samples} samples · {formatLatency(meanLatency)}
          </p>
        )}
      </>
    )
  }
  return (
    <tr>
      <td className="py-5 px-2 bg-gray-200 w-1/6 border border-slate-300">
        {title}
      </td>
      <td className="code px-2 border border-slate-300">
        <pre className="w-full whitespace-pre-wrap break-words">
          <code dangerouslySetInnerHTML={
            {__html: highlightSanitizedJS(code)}} />
        </pre>
      </td>
      <td className={`${(status === 'finished' && fastest) ? 'bg-jsp-green' : ''} ${(status === 'finished' && slowest) ? 'bg-jsp-pink' : ''} ${(status === 'error') ? 'font-bold bg-jsp-pink text-red-600' : ''} text-center w-[120px] p-2 border border-slate-300`}>{result[status] || result.default}</td>
    </tr>
  )
}
