// @ts-nocheck
const SUPPORTED_RUNTIMES = new Set(['node', 'deno', 'bun'])
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

const DEFAULT_LOCAL_IMAGES = {
  node: 'jsperf-bench-node:latest',
  deno: 'jsperf-bench-deno:latest',
  bun: 'jsperf-bench-bun:latest',
}

const LABEL_BY_RUNTIME = {
  node: 'Node.js',
  deno: 'Deno',
  bun: 'Bun',
}

export const DEFAULT_RUNTIME_TARGETS = ['node', 'deno', 'bun'].map(resolveRuntimeTarget)

/**
 * Normalize worker request runtimes into executable targets.
 *
 * Accepted forms:
 *   - "node"                  -> existing local jsperf-bench-node:latest image
 *   - "node@22"               -> official node:22-bookworm-slim image
 *   - { runtime: "bun", version: "1.3.0" }
 */
export function normalizeRuntimeTargets(input) {
  if (!Array.isArray(input)) return null

  const seen = new Set()
  const targets = input
    .map(resolveRuntimeTarget)
    .filter(Boolean)
    .filter((target) => {
      if (seen.has(target.id)) return false
      seen.add(target.id)
      return true
    })

  return targets.length > 0 ? targets : null
}

export function resolveRuntimeTarget(input) {
  const parsed = parseRuntimeInput(input)
  if (!parsed) return null

  const { runtime, version } = parsed
  const image = version
    ? officialImageForVersion(runtime, version)
    : DEFAULT_LOCAL_IMAGES[runtime]

  return {
    id: version ? `${runtime}@${version}` : runtime,
    runtime,
    version,
    label: version ? `${LABEL_BY_RUNTIME[runtime]} ${version}` : LABEL_BY_RUNTIME[runtime],
    image,
    // The local jsperf images include linux-perf. Official versioned images do
    // not, so dynamic version runs still get benchmark numbers but skip perf.
    supportsPerf: !version,
    pull: Boolean(version),
  }
}

export function runtimeBaseName(runtimeId) {
  const value = typeof runtimeId === 'string' ? runtimeId : runtimeId?.runtime
  return value ? String(value).split('@')[0] : ''
}

function parseRuntimeInput(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return null

    const [runtime, version, ...extra] = trimmed.split('@')
    if (extra.length > 0) return null
    return cleanRuntimeVersion(runtime, version || null)
  }

  if (input && typeof input === 'object') {
    return cleanRuntimeVersion(
      input.runtime || input.name,
      input.version == null ? null : input.version,
    )
  }

  return null
}

function cleanRuntimeVersion(runtimeInput, versionInput) {
  const runtime = String(runtimeInput || '').trim().toLowerCase()
  if (!SUPPORTED_RUNTIMES.has(runtime)) return null

  if (versionInput == null || versionInput === '') {
    return { runtime, version: null }
  }

  const version = String(versionInput).trim()
  if (!VERSION_RE.test(version)) return null
  return { runtime, version }
}

function officialImageForVersion(runtime, version) {
  switch (runtime) {
    case 'node':
      return `node:${nodeTag(version)}`
    case 'deno':
      return `denoland/deno:${denoTag(version)}`
    case 'bun':
      return `oven/bun:${bunTag(version)}`
    default:
      throw new Error(`Unsupported runtime: ${runtime}`)
  }
}

function nodeTag(version) {
  if (version === 'latest') return version
  if (/-/.test(version)) return version
  return `${version}-bookworm-slim`
}

function denoTag(version) {
  if (version === 'latest') return version
  if (version.startsWith('debian-') || version.startsWith('alpine-')) return version
  return `debian-${version}`
}

function bunTag(version) {
  if (version === 'latest') return version
  if (/-/.test(version)) return version
  return `${version}-debian`
}
