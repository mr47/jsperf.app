import React, { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts'
import { formatNumber } from '../utils/ArrayUtils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
]

const compactNumber = (num) => {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num)
}

export default function StatsChart({ stats, tests }) {
  if (!stats || Object.keys(stats).length === 0) return null

  // Process data for the overall chart
  const overallData = tests.map((test, index) => {
    const envStats = stats[index] || stats[index.toString()]
    if (!envStats || envStats.length === 0) return { name: test.title, 'Ops/sec': 0, count: 0 }
    
    let totalOps = 0
    let totalCount = 0
    envStats.forEach(stat => {
      totalOps += stat.avgOps * stat.count
      totalCount += stat.count
    })
    
    return {
      name: test.title,
      'Ops/sec': totalCount > 0 ? Math.round(totalOps / totalCount) : 0,
      count: totalCount
    }
  }).filter(data => data.count > 0)

  // Identify tests that have data
  const testsWithStats = tests.map((test, index) => {
    const envStats = stats[index] || stats[index.toString()]
    return {
      testIndex: index,
      testCase: test,
      envStats: envStats || []
    }
  }).filter(item => item.envStats.length > 0)

  return (
    <Tabs defaultValue="overall" className="w-full mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Community Insights</h2>
      </div>
      
      <div className="overflow-x-auto pb-2 mb-4 scrollbar-thin">
        <TabsList className="inline-flex h-auto p-1 bg-muted/50 w-max min-w-full justify-start rounded-lg">
          <TabsTrigger value="overall" className="px-4 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all">
            Overall Comparison
          </TabsTrigger>
          {testsWithStats.map(({ testIndex, testCase }) => (
            <TabsTrigger key={testIndex} value={`test-${testIndex}`} className="px-4 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md transition-all whitespace-nowrap">
              {testCase.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overall" className="mt-0 outline-none">
        {overallData.length > 0 ? (
          <div className="border border-border/60 rounded-xl bg-card shadow-sm p-5 transition-all hover:shadow-md">
            <div className="mb-6">
              <h3 className="text-base font-semibold text-foreground">
                Average Performance Across All Environments
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Comparing the mean operations per second for each test case.
              </p>
            </div>
            <div className="h-[320px] w-full" style={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={overallData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} stroke="var(--border)" opacity={0.3} />
                  <XAxis type="number" tickFormatter={compactNumber} tick={{ fill: 'var(--muted-foreground)' }} />
                  <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 13, fill: 'var(--foreground)' }} />
                  <Tooltip 
                    cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                    formatter={(value, name) => [name === 'Ops/sec' ? formatNumber(value) : value, 'Ops/sec']}
                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ color: 'var(--foreground)', fontWeight: '500' }}
                    labelStyle={{ color: 'var(--muted-foreground)', fontSize: '12px', marginBottom: '4px' }}
                  />
                  <Bar dataKey="Ops/sec" radius={[0, 6, 6, 0]} animationDuration={1000}>
                    {overallData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center border border-border/60 rounded-xl bg-card">
            <p className="text-muted-foreground">Not enough community data available yet.</p>
          </div>
        )}
      </TabsContent>

      {testsWithStats.map(({ testIndex, testCase, envStats }) => {
        const chartData = envStats.slice(0, 5).map(stat => ({
          name: `${stat.browserName} on ${stat.osName || 'unknown'}${stat.cpuArch && stat.cpuArch !== 'unknown' ? ` (${stat.cpuArch})` : ''}`,
          'Ops/sec': Math.round(stat.avgOps),
          count: stat.count
        }))

        return (
          <TabsContent key={testIndex} value={`test-${testIndex}`} className="mt-0 outline-none">
            <div className="border border-border/60 rounded-xl bg-card shadow-sm p-5 transition-all hover:shadow-md">
              <div className="mb-6">
                <h3 className="text-base font-semibold text-foreground">
                  Top Environments for &quot;{testCase.title}&quot;
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Showing the fastest browsers/OS combinations according to community runs.
                </p>
              </div>
              <div className="h-[320px] w-full" style={{ minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} stroke="var(--border)" opacity={0.3} />
                    <XAxis type="number" tickFormatter={compactNumber} tick={{ fill: 'var(--muted-foreground)' }} />
                    <YAxis type="category" dataKey="name" width={220} tick={{ fontSize: 13, fill: 'var(--foreground)' }} />
                    <Tooltip 
                      cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                      formatter={(value, name) => [name === 'Ops/sec' ? formatNumber(value) : value, 'Ops/sec']}
                      contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      itemStyle={{ color: 'var(--foreground)', fontWeight: '500' }}
                      labelStyle={{ color: 'var(--muted-foreground)', fontSize: '12px', marginBottom: '4px' }}
                    />
                    <Bar dataKey="Ops/sec" radius={[0, 6, 6, 0]} animationDuration={1000}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
