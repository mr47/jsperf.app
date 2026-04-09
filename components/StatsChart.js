import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell
} from 'recharts'
import { formatNumber } from '../utils/ArrayUtils'

const COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
]

export default function StatsChart({ stats, tests }) {
  if (!stats || Object.keys(stats).length === 0) return null

  // Process data for the chart
  // We want to compare the top environments across tests.
  // To keep it simple, we'll just plot the top 5 environments for each test.
  
  // Create an array of charts, one for each test case that has stats.
  return (
    <div className="my-6 flex flex-col gap-4">
      {Object.entries(stats).map(([testIndexStr, envStats]) => {
        const testIndex = parseInt(testIndexStr, 10)
        const testCase = tests[testIndex]
        if (!testCase || !envStats || envStats.length === 0) return null

        // Format data for Recharts
        const chartData = envStats.slice(0, 5).map(stat => ({
          name: `${stat.browserName} on ${stat.osName || 'unknown'}${stat.cpuArch && stat.cpuArch !== 'unknown' ? ` (${stat.cpuArch})` : ''}`,
          'Ops/sec': Math.round(stat.avgOps),
          count: stat.count
        }))

        return (
          <div key={testIndex} className="border border-border rounded-lg bg-card p-4">
            <h3 className="text-sm font-semibold mb-4 text-foreground">
              Community Performance: {testCase.title}
            </h3>
            <div className="h-64 w-full" style={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} stroke="var(--border)" opacity={0.2} />
                  <XAxis type="number" tickFormatter={(value) => formatNumber(value)} />
                  <YAxis type="category" dataKey="name" width={220} tick={{ fontSize: 12 }} />
                  <Tooltip 
                    formatter={(value, name) => [name === 'Ops/sec' ? formatNumber(value) : value, 'Ops/sec']}
                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)' }}
                    itemStyle={{ color: 'var(--foreground)' }}
                    labelStyle={{ color: 'var(--foreground)', fontWeight: 'bold', marginBottom: '4px' }}
                  />
                  <Bar dataKey="Ops/sec" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
