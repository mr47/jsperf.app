import crypto from 'crypto'
import { redis } from '../redis'
import { buildAnalysisFromProfiles, runQuickJSAnalysis, runV8Analysis } from '../engines/runner'
import { runWorkerCompositeAnalysis } from '../engines/workerComposite'
import {
  ANALYSIS_SESSION_TTL_SECONDS,
  WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE,
  assertSessionActive,
  attachAnalysisMeta,
  estimateComplexitiesForSession,
  isAbortError,
  maybeEnqueueMultiRuntime,
  mergeMultiRuntimeMeta,
  persistAnalysis,
} from './deepAnalysis'

const DONOR_JOB_STEP_TIMEOUT_MS = 50_000

type DonorJobStatus = 'running' | 'done' | 'errored'

type DonorAnalysisJob = {
  id: string
  sessionId: string
  status: DonorJobStatus
  quickjsIndex: number
  v8Index: number
  quickjsProfiles: any[]
  v8Profiles: any[]
  workerStarted: boolean
  complexities: any[] | null
  multiRuntime: any
  analysis: any
  error?: string
  createdAt: number
  updatedAt: number
}

type AdvanceResult = {
  jobId: string
  status: DonorJobStatus
  phase: string
  progress: {
    total: number
    quickjsDone: number
    v8Done: number
    workerStarted: boolean
  }
  multiRuntime: any
  analysis: any
  error?: string
}

export async function createDonorAnalysisJob(session): Promise<DonorAnalysisJob> {
  const testCount = session.prepared.runtime.tests.length
  const now = Date.now()

  const job: DonorAnalysisJob = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    status: 'running',
    quickjsIndex: 0,
    v8Index: 0,
    quickjsProfiles: Array(testCount).fill(null),
    v8Profiles: Array(testCount).fill(null),
    workerStarted: false,
    complexities: null,
    multiRuntime: null,
    analysis: null,
    createdAt: now,
    updatedAt: now,
  }

  await saveDonorAnalysisJob(job)
  return job
}

export async function loadDonorAnalysisJob(jobId: string): Promise<DonorAnalysisJob | null> {
  if (!jobId || typeof jobId !== 'string') return null
  const raw = await redis.get(donorAnalysisJobKey(jobId))
  if (!raw) return null
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as DonorAnalysisJob
}

export async function advanceDonorAnalysisJob(session, job: DonorAnalysisJob): Promise<AdvanceResult> {
  assertSessionActive(session)
  assertDonorSession(session)
  assertMatchingSession(session, job)

  if (job.status !== 'running') {
    return serializeDonorAnalysisJob(session, job)
  }

  try {
    if (!job.workerStarted) {
      await advanceWorkerPhase(session, job)
      return serializeDonorAnalysisJob(session, job)
    }

    if (job.quickjsIndex < session.prepared.runtime.tests.length) {
      await advanceQuickJSPhase(session, job)
      return serializeDonorAnalysisJob(session, job)
    }

    if (job.v8Index < session.prepared.runtime.tests.length) {
      await advanceV8Phase(session, job)
      return serializeDonorAnalysisJob(session, job)
    }

    await finalizeDonorAnalysis(session, job)
    return serializeDonorAnalysisJob(session, job)
  } catch (error) {
    if (isAbortError(error)) throw error
    job.status = 'errored'
    job.error = error?.message || 'Donor analysis job failed'
    job.updatedAt = Date.now()
    await saveDonorAnalysisJob(job)
    return serializeDonorAnalysisJob(session, job)
  }
}

export function serializeDonorAnalysisJob(session, job: DonorAnalysisJob): AdvanceResult {
  return {
    jobId: job.id,
    status: job.status,
    phase: getCurrentPhase(session, job),
    progress: {
      total: session.prepared.runtime.tests.length,
      quickjsDone: job.quickjsProfiles.filter(Boolean).length,
      v8Done: job.v8Profiles.filter(Boolean).length,
      workerStarted: job.workerStarted,
    },
    multiRuntime: job.multiRuntime,
    analysis: job.analysis,
    error: job.error,
  }
}

async function advanceWorkerPhase(session, job: DonorAnalysisJob) {
  const signal = AbortSignal.timeout(DONOR_JOB_STEP_TIMEOUT_MS)
  if (session.workerExecutionMode === WORKER_EXECUTION_MODE_QUICKJS_COMPOSITE) {
    const composite = await runWorkerCompositeAnalysis(session, { signal })
    if (composite?.unavailable) {
      throw new Error(composite.error || 'Worker-side QuickJS analysis failed')
    }

    job.workerStarted = true
    job.quickjsProfiles = composite.quickjsProfiles
    job.quickjsIndex = session.prepared.runtime.tests.length
    job.multiRuntime = composite.multiRuntime
    job.complexities = Array.isArray(composite.complexities)
      ? composite.complexities
      : Array(session.prepared.runtime.tests.length).fill(null)
    job.updatedAt = Date.now()
    await saveDonorAnalysisJob(job)
    return
  }

  const [multiRuntimeResult, complexityResult] = await Promise.allSettled([
    maybeEnqueueMultiRuntime(session, { signal }),
    estimateComplexitiesForSession(session, signal),
  ])

  job.workerStarted = true
  job.multiRuntime = multiRuntimeResult.status === 'fulfilled'
    ? multiRuntimeResult.value
    : { unavailable: true, error: multiRuntimeResult.reason?.message || 'Worker analysis failed' }
  job.complexities = complexityResult.status === 'fulfilled'
    ? complexityResult.value
    : Array(session.prepared.runtime.tests.length).fill(null)
  job.updatedAt = Date.now()
  await saveDonorAnalysisJob(job)
}

async function advanceQuickJSPhase(session, job: DonorAnalysisJob) {
  const index = job.quickjsIndex
  const profiles = await runQuickJSAnalysis([session.prepared.runtime.tests[index]], {
    setup: session.prepared.runtime.setup || undefined,
    teardown: session.prepared.runtime.teardown || undefined,
    timeMs: 2000,
    signal: AbortSignal.timeout(DONOR_JOB_STEP_TIMEOUT_MS),
    onProgress: undefined,
  })

  job.quickjsProfiles[index] = profiles[0]
  job.quickjsIndex = index + 1
  job.updatedAt = Date.now()
  await saveDonorAnalysisJob(job)
}

async function advanceV8Phase(session, job: DonorAnalysisJob) {
  const index = job.v8Index
  const profiles = await runV8Analysis([session.prepared.runtime.tests[index]], {
    setup: session.prepared.runtime.setup || undefined,
    teardown: session.prepared.runtime.teardown || undefined,
    timeMs: 2000,
    snapshotId: undefined,
    signal: AbortSignal.timeout(DONOR_JOB_STEP_TIMEOUT_MS),
    onProgress: undefined,
  })

  job.v8Profiles[index] = profiles[0]
  job.v8Index = index + 1
  job.updatedAt = Date.now()
  await saveDonorAnalysisJob(job)
}

async function finalizeDonorAnalysis(session, job: DonorAnalysisJob) {
  const analysis = buildAnalysisFromProfiles(session.prepared.runtime.tests, {
    quickjsProfiles: job.quickjsProfiles,
    v8Profiles: job.v8Profiles,
    complexities: job.complexities || undefined,
  })
  const analysisWithMeta = attachAnalysisMeta(analysis, session)
  await persistAnalysis(session, analysisWithMeta)

  job.status = 'done'
  job.analysis = {
    ...mergeMultiRuntimeMeta(analysisWithMeta, job.multiRuntime || null),
    codeHash: session.codeHash,
    multiRuntimeCacheKey: session.multiRuntimeCacheKey,
  }
  job.updatedAt = Date.now()
  await saveDonorAnalysisJob(job)
}

async function saveDonorAnalysisJob(job: DonorAnalysisJob) {
  await redis.setex(donorAnalysisJobKey(job.id), ANALYSIS_SESSION_TTL_SECONDS, JSON.stringify(job))
}

function assertDonorSession(session) {
  if (session?.tier === 'donor') return
  const err = new Error('Donor deep analysis jobs require an active donor session')
  ;(err as any).status = 403
  throw err
}

function assertMatchingSession(session, job: DonorAnalysisJob) {
  if (job.sessionId === session.id) return
  const err = new Error('Analysis job does not belong to this session')
  ;(err as any).status = 400
  throw err
}

function getCurrentPhase(session, job: DonorAnalysisJob) {
  if (job.status !== 'running') return job.status
  if (!job.workerStarted) return 'worker'
  if (job.quickjsIndex < session.prepared.runtime.tests.length) return 'quickjs'
  if (job.v8Index < session.prepared.runtime.tests.length) return 'v8'
  return 'prediction'
}

function donorAnalysisJobKey(jobId: string) {
  return `analysis_donor_job:${jobId}`
}
