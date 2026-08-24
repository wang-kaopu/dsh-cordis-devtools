import type { WaterfallInstrumentationState } from './trace.js'

/** Default finite Agent-owned waterfall experiment duration. */
export const DEFAULT_WATERFALL_EXPERIMENT_TTL_MS = 15_000

/** Default upper bound accepted for one Agent-owned waterfall experiment. */
export const MAX_WATERFALL_EXPERIMENT_TTL_MS = 60_000

/** Opaque identity of one Agent-owned experiment lease. */
export type WaterfallExperimentLeaseId = string

/** The Agent transport boundary that obtained the lease. */
export type WaterfallExperimentSource = 'dsh' | 'mcp'

/** Facts returned for one active Agent-owned experiment. */
export interface WaterfallExperimentLease {
  leaseId: WaterfallExperimentLeaseId
  source: WaterfallExperimentSource
  startedAt: number
  expiresAt: number
}

/** The single authoritative owner of the waterfall instrumentation seam. */
export type WaterfallControlOwner =
  | { kind: 'none' }
  | { kind: 'human' }
  | ({ kind: 'agent' } & WaterfallExperimentLease)

/** Read-only factual ownership + low-level instrumentation state. */
export interface WaterfallExperimentStatus {
  generatedAt: number
  instrumentation: WaterfallInstrumentationState
  owner: WaterfallControlOwner
}

/** Agent request to acquire one finite waterfall experiment lease. */
export interface WaterfallExperimentStartInput {
  ttlMs?: number
}

export type WaterfallExperimentStartOutcome =
  | 'started'
  | 'busy'
  | 'unsupported'
  | 'conflict'

/** A start attempt never fabricates a lease when the controller did not start. */
export interface WaterfallExperimentStartResult {
  outcome: WaterfallExperimentStartOutcome
  lease: WaterfallExperimentLease | null
  status: WaterfallExperimentStatus
}

/** Exact-lease cleanup request. */
export interface WaterfallExperimentStopInput {
  leaseId: WaterfallExperimentLeaseId
}

export type WaterfallExperimentStopOutcome =
  | 'stopped'
  | 'not-active'
  | 'lease-mismatch'
  | 'conflict'

export interface WaterfallExperimentStopResult {
  outcome: WaterfallExperimentStopOutcome
  status: WaterfallExperimentStatus
}

/** Why a previously active Agent lease ended, for coordinator/audit-facing facts. */
export type WaterfallExperimentEndReason =
  | 'stopped'
  | 'expired'
  | 'human-stop'
  | 'disposed'
  | 'conflict'

/**
 * Trace association id. For Agent-owned waterfall traces this is exactly the
 * lease id that owned instrumentation when the trace was created.
 */
export type WaterfallExperimentId = WaterfallExperimentLeaseId
