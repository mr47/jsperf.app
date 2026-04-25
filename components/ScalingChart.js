import { Card, CardContent } from '@/components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { formatNumber } from '../utils/ArrayUtils'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

const compactNumber = (num) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num)

const SCALING_LABELS = {
  'linear': 'improves linearly with more memory headroom',
  'sublinear': 'improves with diminishing returns',
  'plateau': 'is stable across memory limits',
  'degrading': 'slows down as memory pressure changes',
  'noisy': 'results are noisy (low confidence)',
  'insufficient-data': 'not enough data points',
}

function CustomTooltip({ active, payload, label, memoryMap }) {
  if (!active || !payload?.length) return null

  const memLabel = memoryMap?.[label]

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground mb-1.5 font-medium">
        {memLabel || label}
      </p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground font-medium">{entry.name}</span>
          <span className="text-muted-foreground ml-auto pl-3 tabular-nums">{formatNumber(entry.value)} ops/s</span>
        </div>
      ))}
    </div>
  )
}

export default function ScalingPredictionChart({ results }) {
  if (!results || results.length === 0) return null

  const v8Available = results.some(r =>
    r.v8?.profiles?.length > 1 &&
    r.v8.profiles.some(p => p.opsPerSec > 0)
  )

  const getProfiles = (r) => v8Available ? r.v8?.profiles : r.quickjs?.profiles

  const validResults = results.filter(r => {
    const profiles = getProfiles(r)
    return profiles?.length > 1 && profiles.some(p => p.opsPerSec > 0)
  })
  if (validResults.length === 0) return null

  const sourceProfiles = getProfiles(validResults[0])

  // Build a mapping from label to memory description for tooltips
  const memoryMap = {}
  sourceProfiles.forEach(p => {
    const mb = p.memoryMB || 0
    memoryMap[p.label] = mb > 0 ? `${mb} MB memory limit` : p.label
  })

  const chartData = sourceProfiles.map((p, i) => {
    const xLabel = p.memoryMB ? `${p.memoryMB} MB` : p.label
    const point = { resource: xLabel, _label: p.label }
    validResults.forEach((r) => {
      const profile = getProfiles(r)?.[i]
      if (profile) point[r.title] = profile.opsPerSec
    })
    return point
  })

  // Build a map from label to memoryMB for prediction text
  const labelToMB = {}
  sourceProfiles.forEach(p => {
    if (p.memoryMB) labelToMB[p.label] = p.memoryMB
  })

  const predictions = validResults
    .filter(r => r.prediction?.predictedAt && Object.keys(r.prediction.predictedAt).length > 0)

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">
          Memory Response
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          QuickJS memory-limit sweep for spotting allocation pressure. V8 stays on a canonical single-vCPU run because ordinary JS snippets do not use extra CPU cores.
          {!v8Available && ' V8 is still used for the canonical JIT result when available.'}
        </p>

        <div className="h-[260px] w-full" style={{ minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis
                dataKey="resource"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                label={{ value: 'Memory limit', position: 'insideBottom', offset: -2, fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <YAxis
                tickFormatter={compactNumber}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                label={{ value: 'ops/sec', angle: -90, position: 'insideLeft', fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <Tooltip
                content={<CustomTooltip memoryMap={
                  Object.fromEntries(chartData.map(d => [d.resource, memoryMap[d._label] || d.resource]))
                } />}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {validResults.map((r, i) => (
                <Line
                  key={r.testIndex}
                  type="monotone"
                  dataKey={r.title}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {predictions.length > 0 && (
          <div className="mt-4 space-y-2">
            {predictions.map((r, i) => {
              const label = SCALING_LABELS[r.prediction.scalingType] || r.prediction.scalingType
              const pred2x = r.prediction.predictedAt?.['2x']
              const actual1x = r.prediction.predictedAt?.['1x']
              const ratio = actual1x > 0 && pred2x > 0 ? (pred2x / actual1x).toFixed(2) : null
              const mem2x = labelToMB['2x']

              return (
                <div key={r.testIndex} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{r.title}</span>
                    {' '}{label}
                    {ratio && ` — at ${mem2x ? `${mem2x} MB` : '2x'}, measured/modelled ~${ratio}x throughput`}
                    {r.prediction.scalingConfidence < 0.7 && ' (low confidence)'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
