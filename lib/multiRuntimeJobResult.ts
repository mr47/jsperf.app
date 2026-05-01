import { getMultiRuntimeJob } from './engines/multiruntime'
import { buildRuntimeComparison } from './prediction/model'
import {
  loadStoredMultiRuntimeResults,
  persistMultiRuntimeResult,
} from './multiRuntimeResults'
import { persistCpuProfilesFromRuntimes } from './cpuProfiles'

type RuntimeResult = Record<string, unknown>
type RuntimeComparison = { available?: boolean } & Record<string, unknown>
type PartialRuntimeState = Record<string, { profiles?: unknown[], error?: unknown }>

export type ShapedJobPayload =
  | { state: 'done', runtimes: RuntimeResult, runtimeComparison: RuntimeComparison }
  | { state: 'pending' | 'running', partial: ReturnType<typeof shapePartial> }
  | { state: 'errored', error: string }
  | { error: string }

export type ShapedJobResult = {
  status?: number
  storeHit?: boolean
  payload: ShapedJobPayload
}

type ShapedJobOptions = {
  cacheKey?: string | null
  testIndex?: string | number | null
}

export async function getShapedMultiRuntimeJob(jobId: string, {
  cacheKey = null,
  testIndex = null,
}: ShapedJobOptions = {}): Promise<ShapedJobResult> {
  const numericTestIndex = Number.isFinite(Number(testIndex)) ? Number(testIndex) : null

  if (cacheKey && numericTestIndex != null) {
    try {
      const stored = await loadStoredMultiRuntimeResults(cacheKey, [{ testIndex: numericTestIndex }], { requireAll: true })
      const storedResult = stored?.results?.[0]
      if (storedResult) {
        return {
          storeHit: true,
          payload: {
            state: 'done',
            runtimes: storedResult.runtimes,
            runtimeComparison: storedResult.runtimeComparison,
          },
        }
      }
    } catch (err) {
      console.warn('multi-runtime store read failed:', err?.message || err)
    }
  }

  const job = await getMultiRuntimeJob(jobId)

  if (job === null) return { status: 404, payload: { error: 'Unknown job' } }
  if (job.unavailable) return { status: 503, payload: { error: job.error } }

  if (job.state === 'errored') {
    return { payload: { state: 'errored', error: job.error || 'unknown error' } }
  }

  if (job.state === 'pending' || job.state === 'running') {
    return {
      payload: {
        state: job.state,
        partial: shapePartial(job.partial),
      },
    }
  }

  const rawRuntimes = job.result?.runtimes || {}
  const runtimes = cacheKey && numericTestIndex != null
    ? await persistCpuProfilesFromRuntimes({
        cacheKey,
        testIndex: numericTestIndex,
        runtimes: rawRuntimes,
      })
    : rawRuntimes
  const runtimeComparison = buildRuntimeComparison(runtimes)
  const payload: ShapedJobPayload = { state: 'done', runtimes, runtimeComparison }

  if (cacheKey && numericTestIndex != null && runtimeComparison?.available) {
    try {
      await persistMultiRuntimeResult({
        cacheKey,
        testIndex: numericTestIndex,
        runtimes,
        runtimeComparison,
      })
    } catch (err) {
      console.warn('multi-runtime store write failed:', err?.message || err)
    }
  }

  return { payload }
}

export function shapePartial(partial: PartialRuntimeState | null | undefined) {
  if (!partial) return null
  const out: Record<string, { profilesCompleted: number, hasError: boolean }> = {}
  for (const [runtime, data] of Object.entries(partial)) {
    out[runtime] = {
      profilesCompleted: (data.profiles || []).length,
      hasError: Boolean(data.error),
    }
  }
  return out
}
