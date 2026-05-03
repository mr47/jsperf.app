export type JitArtifactEntry = {
  testIndex: number
  title: string
  runtime: string
  runtimeLabel: string
  ref: {
    id: string
    sizeBytes?: number
    lineCount?: number
    truncated?: boolean
  } | null
  error: string | null
}

export type JitArtifactGroup = {
  key: string
  testIndex: number
  title: string
  entries: JitArtifactEntry[]
  artifacts: JitArtifactEntry[]
  errors: JitArtifactEntry[]
  totalSizeBytes: number
  maxSizeBytes: number
  totalLineCount: number
}

export function groupJitArtifactEntries(entries: JitArtifactEntry[]): JitArtifactGroup[] {
  const byTest = new Map<string, JitArtifactGroup>()

  for (const entry of entries) {
    const key = `${Number.isInteger(entry.testIndex) ? entry.testIndex : -1}:${entry.title || ''}`
    let group = byTest.get(key)
    if (!group) {
      group = {
        key,
        testIndex: entry.testIndex,
        title: entry.title || `Test ${Number(entry.testIndex) + 1}`,
        entries: [],
        artifacts: [],
        errors: [],
        totalSizeBytes: 0,
        maxSizeBytes: 0,
        totalLineCount: 0,
      }
      byTest.set(key, group)
    }

    group.entries.push(entry)
    if (entry.ref) {
      group.artifacts.push(entry)
      const sizeBytes = Number(entry.ref.sizeBytes) || 0
      const lineCount = Number(entry.ref.lineCount) || 0
      group.totalSizeBytes += sizeBytes
      group.maxSizeBytes = Math.max(group.maxSizeBytes, sizeBytes)
      group.totalLineCount += lineCount
    }
    if (entry.error) group.errors.push(entry)
  }

  return [...byTest.values()].sort((a, b) => {
    const byIndex = (a.testIndex ?? 0) - (b.testIndex ?? 0)
    return byIndex || a.title.localeCompare(b.title)
  })
}
