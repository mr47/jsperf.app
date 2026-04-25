/**
 * Shared helpers for report slides. Pure functions only — kept
 * separate so they can be unit-tested without rendering React.
 */

const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
})
const integerFormatter = new Intl.NumberFormat('en')

export function formatOps(n) {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1000) return compactFormatter.format(n)
  return integerFormatter.format(Math.round(n))
}

export function formatPercent(n, digits = 1) {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function formatMultiplier(n) {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 100) return `${Math.round(n)}×`
  if (n >= 10) return `${n.toFixed(1)}×`
  return `${n.toFixed(2)}×`
}

export function formatDate(isoOrDate) {
  if (!isoOrDate) return ''
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * A 5-stop gradient from "fastest" (emerald) to "slowest" (rose),
 * pre-baked so slides have a predictable palette regardless of how
 * many tests are in the benchmark.
 */
export function speedColor(rank, total) {
  if (total <= 1) return '#10b981'
  const t = rank / (total - 1)
  // Emerald → Lime → Amber → Orange → Rose
  const stops = [
    [16, 185, 129],
    [132, 204, 22],
    [245, 158, 11],
    [249, 115, 22],
    [244, 63, 94],
  ]
  const scaled = t * (stops.length - 1)
  const i = Math.floor(scaled)
  const frac = scaled - i
  const a = stops[i]
  const b = stops[Math.min(i + 1, stops.length - 1)]
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * frac))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

/** Rank tests by ops/sec (descending), filtering out 0/null entries. */
export function rankEntries(entries = []) {
  return [...entries]
    .filter(e => e.opsPerSec > 0)
    .sort((a, b) => b.opsPerSec - a.opsPerSec)
}

/**
 * Aggregate per-test browser stats into total run counts, per-browser
 * shares, and per-OS shares. Used by the methodology slide.
 */
export function aggregateStats(stats) {
  const browsers = new Map()
  const oses = new Map()
  let totalRuns = 0
  if (stats && typeof stats === 'object') {
    for (const arr of Object.values(stats)) {
      if (!Array.isArray(arr)) continue
      for (const row of arr) {
        const c = row?.count || 0
        if (!c) continue
        totalRuns += c
        const b = row.browserName || 'unknown'
        browsers.set(b, (browsers.get(b) || 0) + c)
        const o = row.osName || 'unknown'
        oses.set(o, (oses.get(o) || 0) + c)
      }
    }
  }
  const toShares = (m) => [...m.entries()]
    .map(([name, count]) => ({ name, count, share: totalRuns ? count / totalRuns : 0 }))
    .sort((a, b) => b.count - a.count)
  return { totalRuns, browsers: toShares(browsers), oses: toShares(oses) }
}

/**
 * Pick which slides to show for this report. Slides whose data isn't
 * present (no analysis, no multi-runtime, etc.) are silently skipped
 * so a blank benchmark doesn't get an empty deck.
 */
/**
 * Walk every test's normalised multi-runtime block and yield each
 * runtime's per-test slot ({test, runtime, avgOpsPerSec, profiles}).
 * Used by the runtimes / perf counters slides so they don't have to
 * know the storage shape.
 */
export function flattenRuntimes(report) {
  const out = []
  for (const r of report?.analysis?.results || []) {
    const byRuntime = r?.multiRuntime?.byRuntime
    if (!byRuntime || typeof byRuntime !== 'object') continue
    for (const [runtime, data] of Object.entries(byRuntime)) {
      if (!data || data.hasError) continue
      out.push({
        testIndex: r.testIndex,
        testTitle: r.title || `Test ${r.testIndex + 1}`,
        runtime,
        avgOpsPerSec: data.avgOpsPerSec || 0,
        profiles: data.profiles || [],
      })
    }
  }
  return out
}

/**
 * Summarise the controlled Node/Deno/Bun worker measurements for the
 * methodology slide. Browser stats and runtime-worker stats are collected
 * through different paths, so the report needs to name both explicitly.
 */
export function aggregateRuntimeSources(report) {
  const slots = flattenRuntimes(report)
  const byRuntime = new Map()
  let totalProfiles = 0

  for (const slot of slots) {
    const profiles = Array.isArray(slot.profiles) ? slot.profiles : []
    totalProfiles += profiles.length

    const current = byRuntime.get(slot.runtime) || {
      runtime: slot.runtime,
      tests: 0,
      profiles: 0,
      opsTotal: 0,
      opsSamples: 0,
      hasPerfCounters: false,
    }
    current.tests += 1
    current.profiles += profiles.length
    if (Number.isFinite(slot.avgOpsPerSec) && slot.avgOpsPerSec > 0) {
      current.opsTotal += slot.avgOpsPerSec
      current.opsSamples += 1
    }
    if (profiles.some(p => p?.perfCounters && Object.keys(p.perfCounters).length > 0)) {
      current.hasPerfCounters = true
    }
    byRuntime.set(slot.runtime, current)
  }

  const runtimes = [...byRuntime.values()]
    .map(r => ({
      runtime: r.runtime,
      tests: r.tests,
      profiles: r.profiles,
      avgOpsPerSec: r.opsSamples ? Math.round(r.opsTotal / r.opsSamples) : 0,
      hasPerfCounters: r.hasPerfCounters,
    }))
    .sort((a, b) => a.runtime.localeCompare(b.runtime, undefined, { numeric: true }))

  return {
    totalRuntimeSlots: slots.length,
    totalProfiles,
    runtimes,
  }
}

/**
 * Across the full report, return every profile that captured perf
 * counters (regardless of which test or runtime). Empty array means
 * the perf-counters slide should be skipped.
 */
export function collectPerfSamples(report) {
  const samples = []
  for (const r of report?.analysis?.results || []) {
    const byRuntime = r?.multiRuntime?.byRuntime
    if (!byRuntime) continue
    for (const [runtime, data] of Object.entries(byRuntime)) {
      for (const p of (data?.profiles || [])) {
        if (p?.perfCounters && Object.keys(p.perfCounters).length) {
          samples.push({
            testIndex: r.testIndex,
            testTitle: r.title || `Test ${r.testIndex + 1}`,
            runtime,
            counters: p.perfCounters,
          })
        }
      }
    }
  }
  return samples
}

/**
 * Pick which slides to show for this report. Slides whose data isn't
 * present (no analysis, no multi-runtime, etc.) are silently skipped
 * so a blank benchmark doesn't get an empty deck.
 */
export function buildDeck(report) {
  const slides = ['title']
  const sum = report?.summary || {}
  const ranked = sum.ranked || []
  const hasRanked = ranked.length >= 2

  if (hasRanked) slides.push('leaderboard')
  if (sum.leader) slides.push('winner')
  if (hasRanked && sum.lagger && sum.leader && sum.lagger.title !== sum.leader.title) {
    slides.push('headToHead')
  }

  if (flattenRuntimes(report).length) slides.push('runtimes')
  if (collectPerfSamples(report).length) slides.push('perfCounters')

  if (hasInsightContent(report?.analysis?.comparison)) slides.push('insight')

  const agg = aggregateStats(report?.stats)
  const runtimeSources = aggregateRuntimeSources(report)
  if (agg.totalRuns > 0 || runtimeSources.runtimes.length > 0) slides.push('methodology')

  slides.push('credits')
  return slides
}

/**
 * The analysis pipeline's `comparison` field is a structured object
 * ({fastestByAlgorithm, fastestByRuntime, divergence}), not free-form
 * text. We only show the insight slide when there's something
 * meaningful to say (i.e. we have at least one fastest index or the
 * server attached prose).
 */
export function hasInsightContent(comparison) {
  if (!comparison) return false
  if (typeof comparison === 'string') return comparison.trim().length > 0
  if (typeof comparison === 'object') {
    if (comparison.summary || comparison.text) return true
    if (Number.isInteger(comparison.fastestByAlgorithm) && comparison.fastestByAlgorithm >= 0) return true
    if (Number.isInteger(comparison.fastestByRuntime) && comparison.fastestByRuntime >= 0) return true
  }
  return false
}
