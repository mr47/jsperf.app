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
  'linear': 'scales linearly with resources',
  'sublinear': 'scales with diminishing returns',
  'plateau': 'plateaus — adding resources won\'t help much',
  'degrading': 'degrades under pressure',
  'noisy': 'results are noisy (low confidence)',
  'insufficient-data': 'not enough data points',
}

export default function ScalingPredictionChart({ results }) {
  if (!results || results.length === 0) return null

  const hasV8Profiles = results.some(r => r.v8?.profiles?.length > 1)
  if (!hasV8Profiles) return null

  // Build chart data: one entry per resource level
  const resourceLevels = results[0].v8.profiles.map(p => p.label)
  const chartData = resourceLevels.map((label, i) => {
    const point = { resource: label }
    results.forEach((r) => {
      const profile = r.v8.profiles[i]
      if (profile) point[r.title] = profile.opsPerSec
    })
    return point
  })

  // Build prediction data if available
  const predictions = results
    .filter(r => r.prediction?.predictedAt && Object.keys(r.prediction.predictedAt).length > 0)

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">
          Scaling Prediction
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          How each snippet performs as resources increase. Steeper = better scaling.
        </p>

        <div className="h-[260px] w-full" style={{ minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis
                dataKey="resource"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                label={{ value: 'Resources', position: 'insideBottom', offset: -2, fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <YAxis
                tickFormatter={compactNumber}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                label={{ value: 'ops/sec', angle: -90, position: 'insideLeft', fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <Tooltip
                formatter={(value) => [formatNumber(value), 'ops/sec']}
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                itemStyle={{ color: 'var(--foreground)', fontWeight: '500' }}
                labelStyle={{ color: 'var(--muted-foreground)', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {results.map((r, i) => (
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

              return (
                <div key={r.testIndex} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{r.title}</span>
                    {' '}{label}
                    {ratio && ` — at 2x resources, expect ~${ratio}x throughput`}
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
