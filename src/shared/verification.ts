export const RUNTIME_CHECKPOINT_SCHEMA_VERSION = 1 as const

export type RuntimeCheckpointSchemaVersion = typeof RUNTIME_CHECKPOINT_SCHEMA_VERSION

/** Exact-name selectors that define the authoritative topology captured by a checkpoint. */
export interface RuntimeCheckpointScope {
  eventNames?: string[]
  fiberNames?: string[]
}

/** Metadata-only recursive Effect projection retained in verification checkpoints. */
export interface RuntimeCheckpointEffect {
  label: string
  children: RuntimeCheckpointEffect[]
}

/** Capture-local Fiber reference. uid is evidence for this capture, not cross-checkpoint identity. */
export interface RuntimeCheckpointFiberRef {
  uid: number
  name: string
  state: string
}

export interface RuntimeCheckpointEvent {
  name: string
  listenerCount: number
}

/**
 * Capture-local listener evidence. id and owner.uid must never be used as semantic
 * identity across checkpoints.
 */
export interface RuntimeCheckpointListener {
  id: number
  event: string
  order: number
  prepend: boolean
  global: boolean
  owner: RuntimeCheckpointFiberRef | null
}

/** Authoritative live Fiber topology captured at one point in time. */
export interface RuntimeCheckpointFiber {
  uid: number
  name: string
  state: string
  parent: RuntimeCheckpointFiberRef | null
  inject: string[]
  ownedEvents: string[]
  effects: RuntimeCheckpointEffect[]
}

/** Self-contained, caller-owned baseline for a later semantic comparison. */
export interface RuntimeCheckpoint {
  schemaVersion: RuntimeCheckpointSchemaVersion
  capturedAt: number
  scope: RuntimeCheckpointScope
  digest: string
  events: RuntimeCheckpointEvent[]
  listeners: RuntimeCheckpointListener[]
  fibers: RuntimeCheckpointFiber[]
}

export interface RuntimeCheckpointCaptureInput {
  scope?: RuntimeCheckpointScope
}

export interface RuntimeCheckpointCompareInput {
  baseline: RuntimeCheckpoint
}

/** Stable listener metadata used for cross-checkpoint multiset comparison. */
export interface RuntimeListenerSemanticDescriptor {
  event: string
  ownerName: string | null
  order: number
  prepend: boolean
  global: boolean
}

/** Stable Fiber metadata used for cross-checkpoint multiset comparison. */
export interface RuntimeFiberSemanticDescriptor {
  name: string
  state: string
  parentName: string | null
  inject: string[]
  ownedEvents: string[]
  effects: RuntimeCheckpointEffect[]
}

export interface RuntimeEventComparison {
  name: string
  beforeListenerCount: number
  afterListenerCount: number
  delta: number
}

export interface RuntimeListenerGroupComparison {
  descriptor: RuntimeListenerSemanticDescriptor
  beforeCount: number
  afterCount: number
  delta: number
}

export interface RuntimeFiberGroupComparison {
  descriptor: RuntimeFiberSemanticDescriptor
  beforeCount: number
  afterCount: number
  delta: number
}

/**
 * Structured semantic comparison. It intentionally reports facts only: no fixed/rootCause/confidence verdicts.
 */
export interface RuntimeCheckpointComparison {
  changed: boolean
  baselineDigest: string
  current: RuntimeCheckpoint
  events: RuntimeEventComparison[]
  listenerGroups: RuntimeListenerGroupComparison[]
  fiberGroups: RuntimeFiberGroupComparison[]
}
