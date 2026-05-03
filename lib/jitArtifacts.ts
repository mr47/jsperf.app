import crypto from 'crypto'
import { jitArtifactsCollection } from './mongodb'

type RuntimeMap = Record<string, any>

const JIT_ARTIFACT_MAX_BYTES = 1024 * 1024

export async function persistJitArtifactsFromRuntimes({
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

  let collection: Awaited<ReturnType<typeof jitArtifactsCollection>> | null = null
  const nextRuntimes: RuntimeMap = {}

  for (const [runtimeId, runtimeData] of Object.entries(runtimes)) {
    const profiles = Array.isArray(runtimeData?.profiles) ? runtimeData.profiles : []
    const nextProfiles = []

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profileResult = profiles[profileIndex]
      const artifact = profileResult?.jitArtifact
      const output = typeof artifact?.output === 'string' ? artifact.output : ''
      if (!output) {
        nextProfiles.push(profileResult)
        continue
      }

      collection ||= await jitArtifactsCollection()
      const profileLabel = profileResult.label || `profile-${profileIndex + 1}`
      const id = jitArtifactId({
        cacheKey,
        testIndex,
        runtimeId,
        profileLabel,
        captureMode: artifact.captureMode || 'v8-opt-code',
      })
      const sizeBytes = Buffer.byteLength(output)
      const meta = {
        format: 'txt',
        language: 'x86asm',
        captureMode: artifact.captureMode || 'v8-opt-code',
        source: artifact.source || 'v8',
        sizeBytes,
        lineCount: countLines(output),
        truncated: Boolean(artifact.truncated),
        maxBytes: Number(artifact.maxBytes) || JIT_ARTIFACT_MAX_BYTES,
        ...(artifact.meta || {}),
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
            output,
            meta,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      )

      const { jitArtifact: _jitArtifact, ...strippedProfile } = profileResult
      nextProfiles.push({
        ...strippedProfile,
        jitArtifactRef: {
          id,
          format: 'txt',
          language: 'x86asm',
          runtime: runtimeId,
          runtimeName: runtimeData?.runtime || runtimeBaseName(runtimeId),
          version: runtimeData?.version || runtimeVersion(runtimeId),
          label: runtimeData?.label || null,
          profileLabel,
          sizeBytes: meta.sizeBytes,
          lineCount: meta.lineCount,
          truncated: meta.truncated,
          captureMode: meta.captureMode,
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

export async function loadJitArtifact(id: string) {
  if (!isValidJitArtifactId(id)) return null
  const collection = await jitArtifactsCollection()
  return collection.findOne({ id }, { projection: { _id: 0 } })
}

export function jitArtifactDownloadName(doc: any) {
  const parts = [
    'jsperf',
    doc?.runtime || 'runtime',
    doc?.testIndex != null ? `test-${doc.testIndex + 1}` : null,
    doc?.profileLabel || null,
    'jit',
  ]
    .filter(Boolean)
    .map(part => String(part).replace(/[^A-Za-z0-9._-]+/g, '-'))
    .filter(Boolean)

  return `${parts.join('-') || 'jit-output'}.txt`
}

function jitArtifactId(input: Record<string, unknown>) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
}

function countLines(value: string) {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}

function isValidJitArtifactId(id: string) {
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
