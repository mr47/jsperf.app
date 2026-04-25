// @ts-nocheck
const DOCKER_REPOS = {
  node: 'library/node',
  deno: 'denoland/deno',
  bun: 'oven/bun',
}

const RUNTIME_LABELS = {
  node: 'Node.js',
  deno: 'Deno',
  bun: 'Bun',
}

const STABLE_VERSION_RE = /\d+\.\d+\.\d+/

export async function fetchRuntimeTagSummary({ fetchImpl = globalThis.fetch, signal } = {}) {
  const entries = await Promise.all(
    Object.entries(DOCKER_REPOS).map(async ([runtime, repo]) => {
      const tags = await fetchDockerTags(repo, { fetchImpl, signal })
      return [runtime, summarizeRuntimeTags(runtime, tags)]
    }),
  )

  const runtimes = Object.fromEntries(entries)
  const options = buildRuntimeOptions(runtimes)

  return {
    generatedAt: new Date().toISOString(),
    runtimes,
    options,
    defaultTargets: options.filter(o => o.default).map(o => o.target),
  }
}

export async function fetchDockerTags(repo, { fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(
    `https://registry.hub.docker.com/v2/repositories/${repo}/tags?page_size=100&page=1`,
    {
      signal,
      headers: { Accept: 'application/json' },
    },
  )

  if (!response.ok) {
    throw new Error(`Docker Hub ${repo} tags failed with ${response.status}`)
  }

  const body = await response.json()
  return Array.isArray(body.results) ? body.results : []
}

export function summarizeRuntimeTags(runtime, tags) {
  const stable = [...new Set(tags
    .map(tag => stableVersionFromTag(tag?.name))
    .filter(Boolean))]
    .sort(compareVersions)
    .reverse()

  const latestStable = stable[0] || null
  const previousStable = stable.find(version => majorOf(version) === majorOf(latestStable) && version !== latestStable)
    || stable.find(version => version !== latestStable)
    || null

  return {
    runtime,
    label: RUNTIME_LABELS[runtime],
    latestStable,
    previousStable,
    latestTagUpdatedAt: updatedAt(tags, 'latest'),
    ltsTagUpdatedAt: runtime === 'node' ? updatedAt(tags, 'lts') : null,
    availableStable: stable.slice(0, 8),
  }
}

function stableVersionFromTag(name) {
  if (typeof name !== 'string') return null
  const match = name.match(STABLE_VERSION_RE)
  return match ? match[0] : null
}

export function buildRuntimeOptions(runtimes) {
  const options = []

  const node = runtimes.node
  if (node) {
    options.push({
      target: 'node@lts',
      runtime: 'node',
      version: 'lts',
      label: 'Node.js LTS',
      detail: node.ltsTagUpdatedAt ? `Docker lts tag updated ${formatDate(node.ltsTagUpdatedAt)}` : 'Docker lts tag',
      kind: 'lts',
      default: true,
    })
    if (node.latestStable) {
      options.push({
        target: `node@${node.latestStable}`,
        runtime: 'node',
        version: node.latestStable,
        label: `Node.js ${node.latestStable}`,
        detail: 'Latest stable release',
        kind: 'latest',
        default: true,
      })
    }
    if (node.previousStable) {
      options.push({
        target: `node@${node.previousStable}`,
        runtime: 'node',
        version: node.previousStable,
        label: `Node.js ${node.previousStable}`,
        detail: 'Previous stable release',
        kind: 'previous',
        default: false,
      })
    }
  }

  for (const runtime of ['deno', 'bun']) {
    const info = runtimes[runtime]
    if (!info) continue

    if (info.latestStable) {
      options.push({
        target: `${runtime}@${info.latestStable}`,
        runtime,
        version: info.latestStable,
        label: `${RUNTIME_LABELS[runtime]} ${info.latestStable}`,
        detail: 'Latest stable release',
        kind: 'latest',
        default: true,
      })
    } else {
      options.push({
        target: `${runtime}@latest`,
        runtime,
        version: 'latest',
        label: `${RUNTIME_LABELS[runtime]} latest`,
        detail: info.latestTagUpdatedAt ? `Docker latest tag updated ${formatDate(info.latestTagUpdatedAt)}` : 'Docker latest tag',
        kind: 'latest',
        default: true,
      })
    }

    if (info.previousStable) {
      options.push({
        target: `${runtime}@${info.previousStable}`,
        runtime,
        version: info.previousStable,
        label: `${RUNTIME_LABELS[runtime]} ${info.previousStable}`,
        detail: 'Previous stable release',
        kind: 'previous',
        default: false,
      })
    }
  }

  return options
}

function updatedAt(tags, name) {
  const tag = tags.find(t => t?.name === name)
  return tag?.last_updated || null
}

function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function parseVersion(version) {
  return String(version || '')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
}

function majorOf(version) {
  if (!version) return null
  return parseVersion(version)[0]
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toISOString().slice(0, 10)
}
