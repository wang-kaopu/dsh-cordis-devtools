import { randomUUID } from 'node:crypto'
import {
  AGENT_DEBUG_CAPABILITIES,
  AGENT_DEBUG_TARGET_TYPE,
} from '../../shared/agent-debug.js'
import type {
  AgentDebugCapability,
  AgentDebugSessionDetail,
  AgentDebugSessionId,
  AgentDebugSessionStaleReason,
  AgentDebugTarget,
  AgentDebugTargetEpoch,
  AgentDebugTargetId,
  AgentDebugTargetMetadata,
} from '../../shared/agent-debug.js'

type Clock = () => number
type IdFactory = () => string

interface CommonRegistryOptions {
  now?: Clock
  createId?: IdFactory
}

export interface AgentDebugTargetActivation {
  metadata: AgentDebugTargetMetadata
  capabilities?: readonly AgentDebugCapability[]
}

export interface AgentDebugTargetLifecycleEvent {
  kind: 'replaced' | 'disposed'
  previous: AgentDebugTarget
  current: AgentDebugTarget | null
}

export interface AgentDebugTargetRegistryOptions extends CommonRegistryOptions {}

const defaultIdFactory: IdFactory = () => randomUUID()
const defaultClock: Clock = () => Date.now()

function uniqueId(factory: IdFactory, used: ReadonlySet<string>): string {
  let id = factory()
  let attempts = 0
  while (used.has(id)) {
    if (++attempts >= 100) throw new Error('id factory did not produce a unique opaque id')
    id = factory()
  }
  return id
}

function cloneTarget(target: AgentDebugTarget | null): AgentDebugTarget | null {
  return target ? { ...target, metadata: { ...target.metadata }, capabilities: [...target.capabilities] } : null
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

/**
 * Owns the one active target incarnation exposed by the host.
 *
 * Every replacement gets a fresh opaque target id and incremented epoch. The
 * registry never rebinds an existing id to a new runtime.
 */
export class AgentDebugTargetRegistry {
  private readonly createId: IdFactory
  private readonly listeners = new Set<(event: AgentDebugTargetLifecycleEvent) => void>()
  private readonly usedIds = new Set<string>()
  private epoch = 0
  private current: AgentDebugTarget | null = null
  private disposed = false

  constructor(options: AgentDebugTargetRegistryOptions = {}) {
    this.createId = options.createId ?? defaultIdFactory
  }

  /**
   * Returns the current target, including a disposed target until the next
   * activation, or null before the first target exists.
   */
  get(): AgentDebugTarget | null {
    return cloneTarget(this.current)
  }

  /**
   * Returns the active target, or null when no runtime is active.
   */
  getActive(): AgentDebugTarget | null {
    return this.current?.status === 'active' ? cloneTarget(this.current) : null
  }

  /**
   * Activates a target and replaces any existing incarnation.
   */
  activate(input: AgentDebugTargetActivation): AgentDebugTarget {
    if (this.disposed) throw new Error('Agent Debug target registry is disposed')
    const previous = this.current
    const targetId = uniqueId(this.createId, this.usedIds)
    this.usedIds.add(targetId)
    this.epoch += 1
    const target: AgentDebugTarget = {
      targetId,
      targetEpoch: this.epoch,
      type: AGENT_DEBUG_TARGET_TYPE,
      status: 'active',
      metadata: { ...input.metadata },
      capabilities: [...(input.capabilities ?? AGENT_DEBUG_CAPABILITIES)],
    }

    if (previous?.status === 'active') {
      const disposed = { ...previous, status: 'disposed' as const }
      this.current = target
      this.emit({ kind: 'replaced', previous: cloneTarget(disposed) as AgentDebugTarget, current: cloneTarget(target) })
    }
    this.current = target
    return cloneTarget(target) as AgentDebugTarget
  }

  /**
   * Replaces the current target with a new runtime incarnation.
   */
  replace(input: AgentDebugTargetActivation): AgentDebugTarget {
    return this.activate(input)
  }

  /**
   * Marks the active target disposed and notifies lifecycle subscribers.
   */
  dispose(): AgentDebugTarget | null {
    if (this.disposed) return this.current
    this.disposed = true
    if (this.current?.status === 'active') {
      const previous = this.current
      const disposed = { ...previous, status: 'disposed' as const }
      this.current = disposed
      this.emit({ kind: 'disposed', previous: cloneTarget(disposed) as AgentDebugTarget, current: null })
    }
    this.listeners.clear()
    return cloneTarget(this.current)
  }

  /**
   * Subscribes to replacement and disposal events. The returned function is
   * idempotent and removes the listener.
   */
  onLifecycle(listener: (event: AgentDebugTargetLifecycleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: AgentDebugTargetLifecycleEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

export interface AgentDebugSessionRegistryOptions extends CommonRegistryOptions {
  maxSessions: number
  sessionIdleTtlMs: number
  maxCursors: number
}

export interface AgentDebugSessionTargetRef {
  targetId: AgentDebugTargetId
  targetEpoch: AgentDebugTargetEpoch
}

export type AgentDebugSessionEndReason =
  | AgentDebugSessionStaleReason
  | 'detached'
  | 'expired'

export interface AgentDebugSessionEndEvent {
  reason: AgentDebugSessionEndReason
  session: AgentDebugSessionDetail
}

interface SessionRecord {
  detail: AgentDebugSessionDetail
  timer: ReturnType<typeof setTimeout>
  abortController: AbortController
  cursorCount: number
}

/**
 * Owns bounded debug sessions and their lifecycle state for target
 * incarnations. Terminal sessions are retained as snapshots until capacity
 * requires their removal, while all associated timers and wait signals are
 * released immediately.
 */
export class AgentDebugSessionRegistry {
  private readonly now: Clock
  private readonly createId: IdFactory
  private readonly maxSessions: number
  private readonly sessionIdleTtlMs: number
  private readonly maxCursors: number
  private readonly sessions = new Map<AgentDebugSessionId, SessionRecord>()
  private readonly listeners = new Set<(event: AgentDebugSessionEndEvent) => void>()
  private readonly usedIds = new Set<string>()
  private disposed = false

  constructor(options: AgentDebugSessionRegistryOptions) {
    validatePositiveInteger(options.maxSessions, 'maxSessions')
    validatePositiveInteger(options.sessionIdleTtlMs, 'sessionIdleTtlMs')
    validatePositiveInteger(options.maxCursors, 'maxCursors')
    this.maxSessions = options.maxSessions
    this.sessionIdleTtlMs = options.sessionIdleTtlMs
    this.maxCursors = options.maxCursors
    this.now = options.now ?? defaultClock
    this.createId = options.createId ?? defaultIdFactory
  }

  /**
   * Attaches a new session to one exact target incarnation.
   */
  attach(target: AgentDebugSessionTargetRef): AgentDebugSessionDetail {
    if (this.disposed) throw new Error('Agent Debug session registry is disposed')
    this.pruneTerminalSessions()
    if (this.sessions.size >= this.maxSessions) {
      this.expireLeastRecentlyAccessed()
      this.pruneTerminalSessions()
    }
    const now = this.now()
    const debugSessionId = uniqueId(this.createId, this.usedIds)
    this.usedIds.add(debugSessionId)
    const detail: AgentDebugSessionDetail = {
      debugSessionId,
      targetId: target.targetId,
      targetEpoch: target.targetEpoch,
      status: 'active',
      stale: false,
      staleReason: null,
      createdAt: now,
      lastAccessedAt: now,
      observationSequence: 0,
    }
    const record: SessionRecord = {
      detail,
      timer: setTimeout(() => this.expire(debugSessionId), this.sessionIdleTtlMs),
      abortController: new AbortController(),
      cursorCount: 0,
    }
    this.sessions.set(debugSessionId, record)
    return { ...detail }
  }

  /**
   * Returns a detached copy of a session snapshot, or null for an unknown id.
   */
  get(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail | null {
    const detail = this.sessions.get(debugSessionId)?.detail
    return detail ? { ...detail } : null
  }

  /**
   * Lists bounded session snapshots in creation order.
   */
  snapshots(): AgentDebugSessionDetail[] {
    return [...this.sessions.values()].map((record) => ({ ...record.detail }))
  }

  /**
   * Refreshes the idle lease of an active session and returns its snapshot.
   */
  touch(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail | null {
    const record = this.sessions.get(debugSessionId)
    if (!record || record.detail.status !== 'active') return record ? { ...record.detail } : null
    record.detail = { ...record.detail, lastAccessedAt: this.now() }
    clearTimeout(record.timer)
    record.timer = setTimeout(() => this.expire(debugSessionId), this.sessionIdleTtlMs)
    return { ...record.detail }
  }

  /**
   * Updates the target-local sequence visible from a session snapshot.
   */
  setObservationSequence(debugSessionId: AgentDebugSessionId, sequence: number): AgentDebugSessionDetail | null {
    const record = this.sessions.get(debugSessionId)
    if (!record || !Number.isInteger(sequence) || sequence < 0) return record ? { ...record.detail } : null
    record.detail = { ...record.detail, observationSequence: Math.max(record.detail.observationSequence, sequence) }
    return { ...record.detail }
  }

  /**
   * Tracks one bounded cursor owned by a session.
   */
  acquireCursor(debugSessionId: AgentDebugSessionId): boolean {
    const record = this.sessions.get(debugSessionId)
    if (!record || record.detail.status !== 'active' || record.cursorCount >= this.maxCursors) return false
    record.cursorCount += 1
    return true
  }

  /**
   * Releases one previously acquired session cursor.
   */
  releaseCursor(debugSessionId: AgentDebugSessionId): void {
    const record = this.sessions.get(debugSessionId)
    if (record) record.cursorCount = Math.max(0, record.cursorCount - 1)
  }

  /**
   * Returns the cancellation signal for a session's active lifetime.
   */
  getAbortSignal(debugSessionId: AgentDebugSessionId): AbortSignal | null {
    return this.sessions.get(debugSessionId)?.abortController.signal ?? null
  }

  /**
   * Detaches a session explicitly and cancels consumers waiting on it.
   */
  detach(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail | null {
    return this.end(debugSessionId, 'detached')
  }

  /**
   * Marks sessions on an exact old target incarnation stale after replacement.
   */
  markTargetReplaced(target: AgentDebugSessionTargetRef): void {
    this.markTargetStale(target, 'target-replaced')
  }

  /**
   * Marks sessions on an exact disposed target incarnation stale.
   */
  markTargetDisposed(target: AgentDebugSessionTargetRef): void {
    this.markTargetStale(target, 'target-disposed')
  }

  /**
   * Subscribes to terminal session events, including stale, detached, and
   * expired transitions.
   */
  onEnd(listener: (event: AgentDebugSessionEndEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Disposes every session and cancels all session-owned timers and waiters.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of [...this.sessions.keys()]) this.end(id, 'host-disposed')
    this.listeners.clear()
  }

  /**
   * Returns the configured cursor capacity for integration layers.
   */
  get cursorCapacity(): number {
    return this.maxCursors
  }

  private markTargetStale(target: AgentDebugSessionTargetRef, reason: AgentDebugSessionStaleReason): void {
    for (const [id, record] of this.sessions) {
      if (record.detail.targetId === target.targetId && record.detail.targetEpoch === target.targetEpoch) {
        this.end(id, reason)
      }
    }
  }

  private expire(debugSessionId: AgentDebugSessionId): void {
    const record = this.sessions.get(debugSessionId)
    if (!record || record.detail.status !== 'active') return
    if (this.now() - record.detail.lastAccessedAt < this.sessionIdleTtlMs) {
      record.timer = setTimeout(() => this.expire(debugSessionId), this.sessionIdleTtlMs)
      return
    }
    this.end(debugSessionId, 'expired')
  }

  private expireLeastRecentlyAccessed(): void {
    const active = [...this.sessions.entries()].filter(([, record]) => record.detail.status === 'active')
    active.sort(([, left], [, right]) => left.detail.lastAccessedAt - right.detail.lastAccessedAt)
    const candidate = active[0]
    if (candidate) this.end(candidate[0], 'expired')
  }

  private pruneTerminalSessions(): void {
    for (const [id, record] of this.sessions) {
      if (record.detail.status !== 'active') {
        clearTimeout(record.timer)
        this.sessions.delete(id)
      }
    }
  }

  private end(debugSessionId: AgentDebugSessionId, reason: AgentDebugSessionEndReason): AgentDebugSessionDetail | null {
    const record = this.sessions.get(debugSessionId)
    if (!record || record.detail.status !== 'active') return record ? { ...record.detail } : null
    clearTimeout(record.timer)
    const isStale = reason === 'target-replaced' || reason === 'target-disposed' || reason === 'host-disposed'
    record.detail = {
      ...record.detail,
      status: isStale ? 'stale' : reason,
      stale: isStale,
      staleReason: isStale ? reason : null,
    }
    record.abortController.abort()
    const snapshot = { ...record.detail }
    for (const listener of [...this.listeners]) listener({ reason, session: snapshot })
    return snapshot
  }
}
