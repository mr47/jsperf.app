/**
 * Hardware performance counters for a single runtime.
 *
 * The worker captures these via `perf stat` when the host kernel allows it.
 * They are entirely optional: many container hosts do not grant the
 * SYS_PTRACE/PERFMON capabilities required, so we silently render nothing
 * if no profile produced counters.
 */

const COUNTER_LABELS = {
  instructions: 'Instructions',
  cycles: 'Cycles',
  'cache-misses': 'Cache misses',
  'branch-misses': 'Branch misses',
  'page-faults': 'Page faults',
  'context-switches': 'Ctx switches',
}

function formatBig(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export default function PerfCounters({ profiles }) {
  if (!profiles || profiles.length === 0) return null

  const profilesWithPerf = profiles.filter(p => p.perfCounters && Object.keys(p.perfCounters).length > 0)
  if (profilesWithPerf.length === 0) return null

  const allCounters = new Set()
  for (const p of profilesWithPerf) {
    for (const k of Object.keys(p.perfCounters)) allCounters.add(k)
  }

  const counterKeys = Object.keys(COUNTER_LABELS).filter(k => allCounters.has(k))
  if (counterKeys.length === 0) return null

  return (
    <details className="mt-3 group">
      <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
        Hardware counters ({profilesWithPerf.length}/{profiles.length} profiles)
      </summary>
      <div className="mt-2 overflow-x-auto -mx-1">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal py-1 px-1">Profile</th>
              {counterKeys.map(k => (
                <th key={k} className="font-normal py-1 px-1 text-right">
                  {COUNTER_LABELS[k]}
                </th>
              ))}
              <th className="font-normal py-1 px-1 text-right">IPC</th>
            </tr>
          </thead>
          <tbody>
            {profilesWithPerf.map((p) => {
              const c = p.perfCounters || {}
              const ipc = c.instructions != null && c.cycles != null && c.cycles > 0
                ? (c.instructions / c.cycles).toFixed(2)
                : '—'
              return (
                <tr key={p.label} className="border-t border-border/30">
                  <td className="py-1 px-1 text-foreground font-medium">{p.label}</td>
                  {counterKeys.map(k => (
                    <td key={k} className="py-1 px-1 text-right tabular-nums text-muted-foreground">
                      {formatBig(c[k])}
                    </td>
                  ))}
                  <td className="py-1 px-1 text-right tabular-nums text-foreground">{ipc}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-muted-foreground/80">
          IPC (instructions/cycle) above ~2 typically means well-vectorized JIT output;
          below ~1 suggests cache or branch misprediction stalls.
        </p>
      </div>
    </details>
  )
}
