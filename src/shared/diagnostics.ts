import type { WaterfallExperimentId } from './experiments.js'
import type {
  DispatchMode,
  DispatchRecord,
  EffectSnapshot,
  FiberSnapshot,
  LiveFiberSnapshot,
  ListenerSnapshot,
} from './types.js'
import type {
  WaterfallDispatchTrace,
  WaterfallInstrumentationState,
} from './trace.js'

export interface BoundedEvidenceWindow {
  bounded: true
  retained: number
}

export interface LimitedEvidenceWindow extends BoundedEvidenceWindow {
  matched: number
  returned: number
  truncated: boolean
}

export interface RuntimeDiagnosticsSummary {
  generatedAt: number
  events: number
  listeners: number
  liveFibers: number
  dispatchWindow: BoundedEvidenceWindow
  profiler: {
    instrumentation: WaterfallInstrumentationState
    traces: BoundedEvidenceWindow
  }
}

export interface RuntimeEventListener extends ListenerSnapshot {
  ownerLive: boolean
}

export interface RuntimeEventInspection {
  generatedAt: number
  name: string
  found: boolean
  listenerCount: number
  listeners: RuntimeEventListener[]
}

export type RuntimeFiberSelector =
  | { uid: number; name?: never }
  | { uid?: never; name: string }

export interface RuntimeFiberDetail extends LiveFiberSnapshot {
  ownedListenerIds: number[]
  ownedEvents: string[]
  recentDispatchContextHits: number
}

export interface RuntimeFiberInspection {
  generatedAt: number
  selector: RuntimeFiberSelector
  matches: RuntimeFiberDetail[]
}

export interface RuntimeDispatchSearchInput {
  event?: string
  fiberUid?: number
  mode?: DispatchMode
  limit?: number
}

export interface RuntimeDispatchSearchResult {
  generatedAt: number
  records: DispatchRecord[]
  window: LimitedEvidenceWindow
}

export interface RuntimeProfilerTraceSearchInput {
  event?: string
  experimentId?: WaterfallExperimentId
  limit?: number
}

export interface RuntimeProfilerTraceSearchResult {
  generatedAt: number
  instrumentation: WaterfallInstrumentationState
  traces: WaterfallDispatchTrace[]
  window: LimitedEvidenceWindow
}

/** Compact machine-facing Fiber reference when a future adapter needs it. */
export type RuntimeFiberReference = FiberSnapshot

/** Effect data remains metadata-only; no disposer/function references cross this contract. */
export type RuntimeEffect = EffectSnapshot
