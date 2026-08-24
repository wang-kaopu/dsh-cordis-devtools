import type { FiberSnapshot } from './types.js'

export type WaterfallTraceOutcome =
  | 'running'
  | 'returned'
  | 'threw'
  | 'pending'
  | 'fulfilled'
  | 'rejected'

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
  startedAt: number
  returnedAt: number | null
  settledAt: number | null
  outcome: WaterfallTraceOutcome
  listeners: WaterfallListenerSpan[]
}

/** Upsert the latest serializable snapshot for one trace id. */
export interface WaterfallTraceSink {
  write(trace: WaterfallDispatchTrace): void
}

/** Read the current bounded trace snapshots without defining transport semantics. */
export interface WaterfallTraceReader {
  snapshot(): readonly WaterfallDispatchTrace[]
}
