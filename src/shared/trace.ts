import type { WaterfallExperimentId, WaterfallExperimentStatus } from './experiments.js'
import type { FiberSnapshot } from './types.js'

export type WaterfallTraceOutcome =
  | 'running'
  | 'returned'
  | 'threw'
  | 'pending'
  | 'fulfilled'
  | 'rejected'

export type WaterfallInstrumentationState =
  | 'disabled'
  | 'enabled'
  | 'conflict'
  | 'unsupported'

export interface WaterfallNextCall {
  id: number
  calledAt: number
  returnedAt: number | null
  settledAt: number | null
  outcome: WaterfallTraceOutcome
}

export interface WaterfallListenerSpan {
  id: string
  listenerId: string
  owner: FiberSnapshot | null
  order: number
  enteredAt: number
  returnedAt: number | null
  settledAt: number | null
  outcome: WaterfallTraceOutcome
  nextCalls: WaterfallNextCall[]
}

export interface WaterfallDispatchTrace {
  version: 1
  id: string
  mode: 'waterfall'
  event: string
  /** Present only when an Agent lease owned instrumentation when this trace began. */
  experimentId?: WaterfallExperimentId
  startedAt: number
  returnedAt: number | null
  settledAt: number | null
  outcome: WaterfallTraceOutcome
  listeners: WaterfallListenerSpan[]
}

export interface WaterfallProfilerSnapshot {
  generatedAt: number
  instrumentation: WaterfallInstrumentationState
  /** Present on v0.6+ Hosts; optional keeps older serialized profiler snapshots readable. */
  experiment?: WaterfallExperimentStatus
  traces: WaterfallDispatchTrace[]
}

/** Upsert the latest serializable snapshot for one trace id. */
export interface WaterfallTraceSink {
  write(trace: WaterfallDispatchTrace): void
}

/** Read the current bounded trace snapshots without defining transport semantics. */
export interface WaterfallTraceReader {
  snapshot(): readonly WaterfallDispatchTrace[]
}

export interface WaterfallProfilerService {
  profilerSnapshot(): WaterfallProfilerSnapshot
  setInstrumentationEnabled(enabled: boolean): WaterfallProfilerSnapshot
}
