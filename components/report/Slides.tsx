// @ts-nocheck
/**
 * Public registry for report presentation slides.
 *
 * The individual slide components live in ./slides/* so this file stays
 * focused on the deck contract consumed by ReportViewer and tests.
 */
import {
  CreditsSlide,
  HeadToHeadSlide,
  LeaderboardSlide,
  SpeedAnimationSlide,
  TitleSlide,
  WinnerSlide,
} from './slides/summarySlides'
import {
  CompatibilityMatrixSlide,
  MemoryResponseSlide,
  MethodologySlide,
  PerfCountersSlide,
  RuntimesSlide,
} from './slides/runtimeSlides'
import {
  BenchmarkDoctorSlide,
  ComplexitySlide,
  InsightSlide,
  JitAmplificationSlide,
} from './slides/analysisSlides'

export const SLIDE_COMPONENTS = {
  title: TitleSlide,
  leaderboard: LeaderboardSlide,
  speedAnimation: SpeedAnimationSlide,
  winner: WinnerSlide,
  headToHead: HeadToHeadSlide,
  runtimes: RuntimesSlide,
  compatibilityMatrix: CompatibilityMatrixSlide,
  benchmarkDoctor: BenchmarkDoctorSlide,
  perfCounters: PerfCountersSlide,
  jitAmplification: JitAmplificationSlide,
  complexity: ComplexitySlide,
  memoryResponse: MemoryResponseSlide,
  insight: InsightSlide,
  methodology: MethodologySlide,
  credits: CreditsSlide,
}

export const SLIDE_LABELS = {
  title: 'Title',
  leaderboard: 'Leaderboard',
  speedAnimation: 'Speed race',
  winner: 'Winner',
  headToHead: 'Head to head',
  runtimes: 'Runtimes',
  compatibilityMatrix: 'Matrix',
  benchmarkDoctor: 'Doctor',
  perfCounters: 'Perf counters',
  jitAmplification: 'JIT boost',
  complexity: 'Complexity',
  memoryResponse: 'Memory',
  insight: 'Insight',
  methodology: 'Methodology',
  credits: 'Credits',
}
