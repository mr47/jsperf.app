import crypto from 'crypto'
import { cpuProfilesCollection } from './mongodb'

type RuntimeMap = Record<string, any>

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
      const profileLabel = profileResult.label || `profile-${profileIndex + 1}`
      const id = cpuProfileId({
        cacheKey,
        testIndex,
        runtimeId,
        profileLabel,
      })
      const encoded = JSON.stringify(cpuProfile)
      const meta = {
        ...(profileResult.cpuProfileMeta || {}),
        format: 'cpuprofile',
        sizeBytes: Buffer.byteLength(encoded),
        nodeCount: Array.isArray(cpuProfile.nodes) ? cpuProfile.nodes.length : 0,
        sampleCount: Array.isArray(cpuProfile.samples) ? cpuProfile.samples.length : 0,
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
