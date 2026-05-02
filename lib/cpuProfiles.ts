import crypto from 'crypto'
import { cpuProfilesCollection } from './mongodb'

type RuntimeMap = Record<string, any>
type CpuProfileNode = {
  id: number
  callFrame?: Record<string, any>
  children?: number[]
  hitCount?: number
  [key: string]: any
}

const USER_CODE_SOURCE_URL = 'jsperf-user-code.js'
const USER_BENCHMARK_FUNCTIONS = new Set(['jsperfUserBenchmark', '__benchFn'])

export async function persistCpuProfilesFromRuntimes({
  cacheKey,
  testIndex,
  runtimes,
}: {
  cacheKey?: string | null
  testIndex: number
  runtimes: RuntimeMap
}) {
  if (!cacheKey || !Number.isInteger(testIndex) || !runtimes || typeof runtimes !== 'object') {
    return runtimes
  }

  let collection: Awaited<ReturnType<typeof cpuProfilesCollection>> | null = null
  const nextRuntimes: RuntimeMap = {}

  for (const [runtimeId, runtimeData] of Object.entries(runtimes)) {
    const profiles = Array.isArray(runtimeData?.profiles) ? runtimeData.profiles : []
    const nextProfiles = []

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profileResult = profiles[profileIndex]
      if (!profileResult?.cpuProfile) {
        nextProfiles.push(profileResult)
        continue
      }

      collection ||= await cpuProfilesCollection()
      const cpuProfile = profileResult.cpuProfile
      const focusedCpuProfile = focusCpuProfileOnUserCode(cpuProfile)
      const profileLabel = profileResult.label || `profile-${profileIndex + 1}`
      const id = cpuProfileId({
        cacheKey,
        testIndex,
        runtimeId,
        profileLabel,
      })
      const encoded = JSON.stringify(cpuProfile)
      const focusedStats = cpuProfileStats(focusedCpuProfile)
      const meta = {
        ...(profileResult.cpuProfileMeta || {}),
        format: 'cpuprofile',
        sizeBytes: Buffer.byteLength(encoded),
        nodeCount: Array.isArray(cpuProfile.nodes) ? cpuProfile.nodes.length : 0,
        sampleCount: Array.isArray(cpuProfile.samples) ? cpuProfile.samples.length : 0,
        focusedNodeCount: focusedStats.nodeCount,
        focusedSampleCount: focusedStats.sampleCount,
      }
      const now = new Date()

      await collection.updateOne(
        { id },
        {
          $set: {
            id,
            multiRuntimeCacheKey: cacheKey,
            testIndex,
            runtime: runtimeId,
            runtimeName: runtimeData?.runtime || runtimeBaseName(runtimeId),
            version: runtimeData?.version || runtimeVersion(runtimeId),
            label: runtimeData?.label || null,
            profileLabel,
            cpuProfile,
            focusedCpuProfile,
            meta,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      )

      const { cpuProfile: _cpuProfile, ...strippedProfile } = profileResult
      nextProfiles.push({
        ...strippedProfile,
        cpuProfileMeta: meta,
        cpuProfileRef: {
          id,
          format: 'cpuprofile',
          runtime: runtimeId,
          runtimeName: runtimeData?.runtime || runtimeBaseName(runtimeId),
          version: runtimeData?.version || runtimeVersion(runtimeId),
          label: runtimeData?.label || null,
          profileLabel,
          sizeBytes: meta.sizeBytes,
          nodeCount: meta.nodeCount,
          sampleCount: meta.sampleCount,
          focusedNodeCount: meta.focusedNodeCount,
          focusedSampleCount: meta.focusedSampleCount,
        },
      })
    }

    nextRuntimes[runtimeId] = {
      ...runtimeData,
      profiles: nextProfiles,
    }
  }

  return nextRuntimes
}

export async function loadCpuProfile(id: string) {
  if (!isValidCpuProfileId(id)) return null
  const collection = await cpuProfilesCollection()
  return collection.findOne({ id }, { projection: { _id: 0 } })
}

export function getFocusedCpuProfile(doc: any) {
  if (doc?.focusedCpuProfile) return doc.focusedCpuProfile
  return focusCpuProfileOnUserCode(doc?.cpuProfile)
}

export function focusCpuProfileOnUserCode(profile: any) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes as CpuProfileNode[] : []
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const timeDeltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : []
  if (nodes.length === 0 || samples.length === 0) return profile

  const byId = new Map<number, CpuProfileNode>()
  const parentById = new Map<number, number>()
  for (const node of nodes) {
    byId.set(node.id, node)
    for (const childId of Array.isArray(node.children) ? node.children : []) {
      parentById.set(childId, node.id)
    }
  }

  const focusedRoot: CpuProfileNode = {
    id: 1,
    callFrame: {
      functionName: '(root)',
      scriptId: '0',
      url: '',
      lineNumber: -1,
      columnNumber: -1,
    },
    hitCount: 0,
    children: [],
  }
  const focusedNodes: CpuProfileNode[] = [focusedRoot]
  const focusedById = new Map<number, CpuProfileNode>([[focusedRoot.id, focusedRoot]])
  const cloneByParentAndFrame = new Map<string, number>()
  const focusedSamples: number[] = []
  const focusedTimeDeltas: number[] = []
  let nextId = 2

  for (let i = 0; i < samples.length; i++) {
    const originalPath = pathToRoot(Number(samples[i]), byId, parentById)
    const userIndex = originalPath.findIndex(isUserCodeProfileFrame)
    if (userIndex === -1) continue

    let focusedParentId = focusedRoot.id
    for (const originalNode of originalPath.slice(userIndex)) {
      const cloneKey = `${focusedParentId}\0${callFrameKey(originalNode.callFrame)}`
      let focusedId = cloneByParentAndFrame.get(cloneKey)

      if (!focusedId) {
        focusedId = nextId++
        const clone = cloneCpuProfileNode(originalNode, focusedId)
        cloneByParentAndFrame.set(cloneKey, focusedId)
        focusedNodes.push(clone)
        focusedById.set(focusedId, clone)
        focusedById.get(focusedParentId)?.children?.push(focusedId)
      }

      focusedParentId = focusedId
    }

    focusedSamples.push(focusedParentId)
    focusedTimeDeltas.push(Number(timeDeltas[i]) || 0)
    const leaf = focusedById.get(focusedParentId)
    if (leaf) leaf.hitCount = (leaf.hitCount || 0) + 1
  }

  if (focusedSamples.length === 0) return profile

  return {
    ...profile,
    nodes: focusedNodes,
    samples: focusedSamples,
    timeDeltas: timeDeltas.length > 0 ? focusedTimeDeltas : undefined,
    jsPerfFocus: {
      mode: 'user-code',
      sourceURL: USER_CODE_SOURCE_URL,
      rawSampleCount: samples.length,
      droppedSampleCount: samples.length - focusedSamples.length,
    },
  }
}

export function cpuProfileDownloadName(doc: any) {
  const parts = [
    'jsperf',
    doc?.runtime || 'runtime',
    doc?.testIndex != null ? `test-${doc.testIndex + 1}` : null,
    doc?.profileLabel || null,
  ]
    .filter(Boolean)
    .map(part => String(part).replace(/[^A-Za-z0-9._-]+/g, '-'))
    .filter(Boolean)

  return `${parts.join('-') || 'profile'}.cpuprofile`
}

function cpuProfileId(input: Record<string, unknown>) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
}

function cpuProfileStats(profile: any) {
  return {
    nodeCount: Array.isArray(profile?.nodes) ? profile.nodes.length : 0,
    sampleCount: Array.isArray(profile?.samples) ? profile.samples.length : 0,
  }
}

function pathToRoot(
  nodeId: number,
  byId: Map<number, CpuProfileNode>,
  parentById: Map<number, number>,
) {
  const path: CpuProfileNode[] = []
  const seen = new Set<number>()
  let currentId: number | undefined = nodeId

  while (currentId != null && !seen.has(currentId)) {
    const node = byId.get(currentId)
    if (!node) break
    seen.add(currentId)
    path.push(node)
    currentId = parentById.get(currentId)
  }

  return path.reverse()
}

function isUserCodeProfileFrame(node: CpuProfileNode) {
  const callFrame = node.callFrame || {}
  const url = String(callFrame.url || '')
  const functionName = String(callFrame.functionName || '')
  return url.includes(USER_CODE_SOURCE_URL) || USER_BENCHMARK_FUNCTIONS.has(functionName)
}

function cloneCpuProfileNode(node: CpuProfileNode, id: number): CpuProfileNode {
  const { children: _children, hitCount: _hitCount, ...rest } = node
  return {
    ...rest,
    id,
    callFrame: { ...(node.callFrame || {}) },
    hitCount: 0,
    children: [],
  }
}

function callFrameKey(callFrame: Record<string, any> = {}) {
  return [
    callFrame.functionName || '',
    callFrame.scriptId || '',
    callFrame.url || '',
    callFrame.lineNumber ?? '',
    callFrame.columnNumber ?? '',
  ].join('\0')
}

function isValidCpuProfileId(id: string) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)
}

function runtimeBaseName(runtimeId: string) {
  return typeof runtimeId === 'string' ? runtimeId.split('@')[0] : ''
}

function runtimeVersion(runtimeId: string) {
  if (typeof runtimeId !== 'string') return null
  const marker = runtimeId.indexOf('@')
  return marker === -1 ? null : runtimeId.slice(marker + 1)
}
