import type { WaterfallInstrumentationState } from './trace.js'

/** Stable name of the transport-neutral DSH DevTools for Agents contract. */
export const AGENT_DEBUG_PROTOCOL_NAME = 'dsh-devtools-for-agents' as const

/** Version of the shared Agent Debug contract. */
export const AGENT_DEBUG_PROTOCOL_VERSION = 1 as const

/** Default maximum number of records returned by one catalog section. */
export const DEFAULT_AGENT_DEBUG_CATALOG_LIMIT = 100 as const

/** Maximum catalog page size accepted by the Agent Debug core. */
export const MAX_AGENT_DEBUG_CATALOG_LIMIT = 100 as const

/** Default bounded wait duration for an Agent runtime observation. */
export const DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS = 15_000 as const

/** Maximum bounded wait duration for an Agent runtime observation. */
export const MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS = 60_000 as const

/** Features exposed by a v1 Agent Debug target. */
export const AGENT_DEBUG_CAPABILITIES = [
  'target-discovery',
  'debug-session',
  'runtime-snapshot',
  'runtime-wait',
  'checkpoint-compare',
  'waterfall-profiler',
] as const

/** Exact target kind exposed by the v1 Cordis runtime adapter. */
export const AGENT_DEBUG_TARGET_TYPE = 'cordis-runtime' as const

/** Target lifecycle vocabulary. */
export const AGENT_DEBUG_TARGET_STATUSES = ['active', 'disposed'] as const

/** Debug-session lifecycle vocabulary. */
export const AGENT_DEBUG_SESSION_STATUSES = ['active', 'stale', 'detached', 'expired'] as const

/** Exact observation kinds retained by the v1 bounded journal. */
export const AGENT_DEBUG_OBSERVATION_TYPES = [
  'dispatch-observed',
  'topology-invalidated',
  'profiler-trace-updated',
  'profiler-status-changed',
  'target-disposed',
] as const

/** Exploration snapshot sections understood by the Agent Debug core. */
export const AGENT_DEBUG_SNAPSHOT_SECTIONS = [
  'summary',
  'events',
  'fibers',
  'dispatches',
  'profiler',
  'candidates',
] as const

/** Mechanical candidate kinds; these describe evidence and never a diagnosis. */
export const AGENT_DEBUG_MECHANICAL_CANDIDATE_KINDS = [
  'duplicate-live-fibers',
  'equivalent-listener-registrations',
  'orphaned-listener-owner',
  'trace-next-anomaly',
  'instrumentation-conflict',
] as const

/** Outcome vocabulary returned by a bounded runtime wait. */
export const AGENT_DEBUG_WAIT_OUTCOMES = ['found', 'timeout', 'gap'] as const

/** Opaque identity of one Agent Debug target. */
export type AgentDebugTargetId = string

/** Monotonic epoch of a target incarnation. */
export type AgentDebugTargetEpoch = number

/** Supported Agent Debug target kind. */
export type AgentDebugTargetType = (typeof AGENT_DEBUG_TARGET_TYPE)

/** Target lifecycle state. */
export type AgentDebugTargetStatus = (typeof AGENT_DEBUG_TARGET_STATUSES)[number]

/** One capability advertised by a target. */
export type AgentDebugCapability = (typeof AGENT_DEBUG_CAPABILITIES)[number]

/** Protocol identity and capabilities advertised by one Agent Debug target. */
export interface AgentDebugProtocolInfo {
  name: typeof AGENT_DEBUG_PROTOCOL_NAME
  version: typeof AGENT_DEBUG_PROTOCOL_VERSION
  capabilities: readonly AgentDebugCapability[]
}

/** Target metadata that is safe to expose to an Agent. */
export interface AgentDebugTargetMetadata {
  title: string
  pluginVersion: string | null
  cordisVersion: string | null
}

/** A discovered DSH runtime target. */
export interface AgentDebugTarget {
  targetId: AgentDebugTargetId
  targetEpoch: AgentDebugTargetEpoch
  type: AgentDebugTargetType
  status: AgentDebugTargetStatus
  metadata: AgentDebugTargetMetadata
  capabilities: readonly AgentDebugCapability[]
}

/** Opaque identity of one Host-owned Agent Debug session. */
export type AgentDebugSessionId = string

/** Debug-session lifecycle state. */
export type AgentDebugSessionStatus = (typeof AGENT_DEBUG_SESSION_STATUSES)[number]

/** Fact explaining why a session can no longer address its target. */
export type AgentDebugSessionStaleReason = 'target-replaced' | 'target-disposed' | 'host-disposed'

/** Factual state of an attached Agent Debug session. */
export interface AgentDebugSessionDetail {
  debugSessionId: AgentDebugSessionId
  targetId: AgentDebugTargetId
  targetEpoch: AgentDebugTargetEpoch
  status: AgentDebugSessionStatus
  stale: boolean
  staleReason: AgentDebugSessionStaleReason | null
  createdAt: number
  lastAccessedAt: number
  observationSequence: AgentDebugObservationSequence
}

/** Target-local monotonic observation sequence number. */
export type AgentDebugObservationSequence = number

/** Bounded retained-journal window metadata. */
export interface AgentDebugObservationWindow {
  bounded: true
  oldestSequence: AgentDebugObservationSequence | null
  newestSequence: AgentDebugObservationSequence | null
  retained: number
  truncated: boolean
  gap: boolean
}

/** One metadata-only observation retained by the bounded journal. */
export interface AgentDebugObservationBase {
  sequence: AgentDebugObservationSequence
  observedAt: number
}

/** Pre-execution dispatch fact; event arguments and returns are intentionally absent. */
export interface AgentDebugDispatchObserved extends AgentDebugObservationBase {
  type: 'dispatch-observed'
  dispatchId: number
  event: string
  mode: string
  argCount: number
  registeredListeners: number
}

/** Indicates that authoritative topology should be queried again. */
export interface AgentDebugTopologyInvalidated extends AgentDebugObservationBase {
  type: 'topology-invalidated'
  reason: 'event-listeners' | 'fibers' | 'snapshot'
}

/** Indicates that a retained metadata-only waterfall trace changed. */
export interface AgentDebugProfilerTraceUpdated extends AgentDebugObservationBase {
  type: 'profiler-trace-updated'
  traceId: string
  event: string
}

/** Indicates that profiler instrumentation ownership/state changed. */
export interface AgentDebugProfilerStatusChanged extends AgentDebugObservationBase {
  type: 'profiler-status-changed'
  instrumentation: WaterfallInstrumentationState
}

/** Indicates that the target can no longer receive new debug requests. */
export interface AgentDebugTargetDisposed extends AgentDebugObservationBase {
  type: 'target-disposed'
  targetId: AgentDebugTargetId
  targetEpoch: AgentDebugTargetEpoch
}

/** Union of all v1 metadata-only observations. */
export type AgentDebugObservation =
  | AgentDebugDispatchObserved
  | AgentDebugTopologyInvalidated
  | AgentDebugProfilerTraceUpdated
  | AgentDebugProfilerStatusChanged
  | AgentDebugTargetDisposed

/** Opaque cursor for a bounded catalog page. */
export type AgentDebugCatalogCursor = string

/** Common paging input for snapshot catalogs. */
export interface AgentDebugCatalogInput {
  limit?: number
  cursor?: AgentDebugCatalogCursor
}

/** Explicit paging facts returned with every catalog section. */
export interface AgentDebugCatalogWindow {
  bounded: true
  limit: number
  returned: number
  total: number
  truncated: boolean
  cursor: AgentDebugCatalogCursor | null
  nextCursor: AgentDebugCatalogCursor | null
}

/** A bounded page of metadata records. */
export interface AgentDebugCatalog<T> {
  items: readonly T[]
  window: AgentDebugCatalogWindow
}

/** Metadata-only Event catalog entry for cold-start exploration. */
export interface AgentDebugEventCatalogEntry {
  name: string
  listenerCount: number
}

/** Metadata-only Fiber catalog entry for cold-start exploration. */
export interface AgentDebugFiberCatalogEntry {
  uid: number
  name: string
  state: string
  parentUid: number | null
  ownedListenerCount: number
  ownedEventCount: number
}

/** Metadata-only recent dispatch overview for exploration. */
export interface AgentDebugDispatchCatalogEntry {
  dispatchId: number
  timestamp: number
  event: string
  mode: string
  registeredListeners: number
}

/** Metadata-only profiler status section for exploration. */
export interface AgentDebugProfilerCatalogEntry {
  instrumentation: WaterfallInstrumentationState
  traceCount: number
}

/** A factual mechanical candidate reference with no diagnosis or remediation. */
export interface AgentDebugMechanicalCandidate {
  kind: AgentDebugMechanicalCandidateKind
  key: string
  count: number
  evidence: readonly AgentDebugCandidateFact[]
}

/** Mechanical candidate vocabulary. */
export type AgentDebugMechanicalCandidateKind = (typeof AGENT_DEBUG_MECHANICAL_CANDIDATE_KINDS)[number]

/** One primitive fact supporting a mechanical candidate. */
export interface AgentDebugCandidateFact {
  field: string
  value: string | number | boolean | null
}

/** Runtime counts useful for Agent exploration without inferred conclusions. */
export interface AgentDebugRuntimeSummary {
  generatedAt: number
  events: number
  listeners: number
  liveFibers: number
  dispatchesRetained: number
  tracesRetained: number
}

/** Section selection for an exploration snapshot. */
export type AgentDebugSnapshotSection = (typeof AGENT_DEBUG_SNAPSHOT_SECTIONS)[number]

/** Input selecting metadata-only exploration sections and their bounded pages. */
export interface AgentDebugSnapshotInput {
  debugSessionId: AgentDebugSessionId
  sections?: readonly AgentDebugSnapshotSection[]
  catalogs?: Partial<Record<Exclude<AgentDebugSnapshotSection, 'summary' | 'profiler'>, AgentDebugCatalogInput>>
}

/** Metadata-only exploration snapshot assembled from authoritative Host facts. */
export interface AgentDebugExplorationSnapshot {
  generatedAt: number
  /** Journal sequence captured before snapshot traversal began. */
  eventCursor: AgentDebugObservationSequence
  target: AgentDebugTarget
  session: AgentDebugSessionDetail
  summary: AgentDebugRuntimeSummary | null
  events: AgentDebugCatalog<AgentDebugEventCatalogEntry> | null
  fibers: AgentDebugCatalog<AgentDebugFiberCatalogEntry> | null
  dispatches: AgentDebugCatalog<AgentDebugDispatchCatalogEntry> | null
  profiler: AgentDebugProfilerCatalogEntry | null
  candidates: AgentDebugCatalog<AgentDebugMechanicalCandidate> | null
}

/** Exact observation filter accepted by the bounded wait operation. */
export interface AgentDebugObservationFilter {
  type?: AgentDebugObservationType
  event?: string
}

/** Observation type vocabulary used by exact wait filters. */
export type AgentDebugObservationType = (typeof AGENT_DEBUG_OBSERVATION_TYPES)[number]

/** Input for one bounded, resumable runtime observation wait. */
export interface AgentDebugWaitForRuntimeChangeInput {
  debugSessionId: AgentDebugSessionId
  afterSequence?: AgentDebugObservationSequence
  type?: AgentDebugObservationType
  event?: string
  timeoutMs?: number
}

/** Input for reading retained metadata-only observations after a cursor. */
export interface AgentDebugReadObservationsInput {
  debugSessionId: AgentDebugSessionId
  afterSequence?: AgentDebugObservationSequence
  type?: AgentDebugObservationType
  event?: string
}

/** Result of reading the bounded target-local observation journal. */
export interface AgentDebugReadObservationsResult {
  observations: readonly AgentDebugObservation[]
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Found observation returned by a bounded wait. */
export interface AgentDebugWaitFound {
  outcome: 'found'
  observation: AgentDebugObservation
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Factual timeout returned when no matching observation arrived in time. */
export interface AgentDebugWaitTimeout {
  outcome: 'timeout'
  observation: null
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Explicit retained-window gap returned for an expired cursor. */
export interface AgentDebugWaitGap {
  outcome: 'gap'
  observation: null
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Result union for one bounded runtime observation wait. */
export type AgentDebugWaitForRuntimeChangeResult = AgentDebugWaitFound | AgentDebugWaitTimeout | AgentDebugWaitGap
