import { randomUUID } from 'node:crypto'
import type {
  WaterfallExperimentSource,
  WaterfallExperimentStartInput,
  WaterfallExperimentStartResult,
  WaterfallExperimentStopInput,
  WaterfallExperimentStopResult,
} from '../../shared/experiments.js'
import {
  AGENT_DEBUG_CAPABILITIES,
  DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS,
  type AgentDebugCatalog,
  type AgentDebugCatalogCursor,
  type AgentDebugCatalogInput,
  type AgentDebugExplorationSnapshot,
  type AgentDebugSessionDetail,
  type AgentDebugSessionId,
  type AgentDebugSnapshotInput,
  type AgentDebugSnapshotSection,
  type AgentDebugTarget,
  type AgentDebugWaitForRuntimeChangeInput,
  type AgentDebugWaitForRuntimeChangeResult,
} from '../../shared/agent-debug.js'
import type { DevtoolsSnapshot } from '../../shared/types.js'
import type { WaterfallProfilerSnapshot } from '../../shared/trace.js'
import { AgentDebugObservationJournal, type AgentDebugJournalWaitResult, type AgentDebugObservationInput } from './observation-journal.js'
import {
  AgentDebugSessionRegistry,
  AgentDebugTargetRegistry,
  type AgentDebugTargetActivation,
} from './target-session.js'
import {
  pageAgentDebugCatalog,
  projectAgentDebugSnapshot,
} from './snapshot-projection.js'
import type { RuntimeNotification, RuntimeNotificationSource } from '../runtime-notifications.js'

type Clock = () => number
type IdFactory = () => string

const ALL_SECTIONS: readonly AgentDebugSnapshotSection[] = ['summary', 'events', 'fibers', 'dispatches', 'profiler', 'candidates']

/** Authoritative facts and mutation boundaries consumed by the transport-neutral service. */
export interface AgentDebugServicePorts {
  /** Returns the current metadata-only Cordis snapshot. */
  snapshot: () => DevtoolsSnapshot
  /** Returns the current metadata-only profiler snapshot. */
  profilerSnapshot: () => WaterfallProfilerSnapshot
  /** Starts an Agent experiment through the existing coordinator. */
  startAgent: (source: WaterfallExperimentSource, input?: WaterfallExperimentStartInput) => WaterfallExperimentStartResult
  /** Stops an Agent experiment through the existing coordinator. */
  stopAgent: (input: WaterfallExperimentStopInput) => WaterfallExperimentStopResult
  /** The single Host-owned metadata-only notification fan-out. */
  runtimeNotifications: RuntimeNotificationSource
}

/** Bounded lifecycle and identity options for the Agent Debug composition core. */
export interface AgentDebugServiceOptions {
  /** Authoritative ports and the one Host-local notification source. */
  ports: AgentDebugServicePorts
  /** Safe display title for the active target. */
  targetTitle?: string
  /** Maximum number of simultaneously retained debug sessions. */
  maxSessions?: number
  /** Maximum idle lifetime for one debug session. */
  sessionIdleTtlMs?: number
  /** Maximum number of live catalog cursors across one session. */
  maxCursors?: number
  /** Maximum retained metadata-only observations. */
  observationCapacity?: number
  /** Maximum pending wait calls. */
  maxWaiters?: number
  /** Default bounded wait duration. */
  defaultWaitTimeoutMs?: number
  /** Clock seam used for target observations and session timestamps. */
  now?: Clock
  /** Opaque target id seam. */
  createTargetId?: IdFactory
  /** Opaque session id seam. */
  createSessionId?: IdFactory
  /** Opaque cursor id seam. */
  createCursorId?: IdFactory
}

interface CursorRecord {
  sessionId: AgentDebugSessionId
  section: Exclude<AgentDebugSnapshotSection, 'summary' | 'profiler'>
  items: readonly unknown[]
  offset: number
}

/**
 * Composes Host-owned Agent Debug target, session, snapshot, observation, and
 * experiment ownership semantics without knowing any transport protocol.
 */
export class AgentDebugService {
  private readonly now: Clock
  private readonly ports: AgentDebugServicePorts
  private readonly cursorFactory: IdFactory
  private readonly targets: AgentDebugTargetRegistry
  private readonly sessions: AgentDebugSessionRegistry
  private readonly journal: AgentDebugObservationJournal
  private readonly cursors = new Map<AgentDebugCatalogCursor, CursorRecord>()
  private readonly ownedLeases = new Map<string, AgentDebugSessionId>()
  private readonly unsubscribeNotifications: () => void
  private readonly unsubscribeTargetLifecycle: () => void
  private readonly unsubscribeSessionEnd: () => void
  private disposed = false

  /** Creates one target-local Agent Debug composition core. */
  constructor(options: AgentDebugServiceOptions) {
    this.now = options.now ?? (() => Date.now())
    this.ports = options.ports
    this.cursorFactory = options.createCursorId ?? randomUUID
    this.targets = new AgentDebugTargetRegistry({ createId: options.createTargetId })
    this.sessions = new AgentDebugSessionRegistry({
      maxSessions: options.maxSessions ?? 32,
      sessionIdleTtlMs: options.sessionIdleTtlMs ?? 15 * 60_000,
      maxCursors: options.maxCursors ?? 8,
      now: this.now,
      createId: options.createSessionId,
    })
    this.journal = new AgentDebugObservationJournal({
      capacity: options.observationCapacity ?? 500,
      maxWaiters: options.maxWaiters ?? 32,
      now: this.now,
      defaultTimeoutMs: options.defaultWaitTimeoutMs ?? DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS,
    })

    const activation: AgentDebugTargetActivation = {
      metadata: {
        title: options.targetTitle ?? 'Cordis Runtime',
        pluginVersion: null,
        cordisVersion: null,
      },
      capabilities: AGENT_DEBUG_CAPABILITIES,
    }
    this.targets.activate(activation)
    this.unsubscribeTargetLifecycle = this.targets.onLifecycle((event) => {
      if (this.disposed) return
      if (event.kind === 'replaced') {
        this.sessions.markTargetReplaced(event.previous)
        this.appendTargetDisposed(event.previous)
      } else {
        this.sessions.markTargetDisposed(event.previous)
        this.appendTargetDisposed(event.previous)
      }
    })
    this.unsubscribeSessionEnd = this.sessions.onEnd(({ session }) => this.releaseSessionResources(session.debugSessionId))
    this.unsubscribeNotifications = this.ports.runtimeNotifications.subscribe((notification) => this.appendNotification(notification))
  }

  /** Lists the one active Cordis runtime target, when one exists. */
  listTargets(): AgentDebugTarget[] {
    const target = this.targets.getActive()
    return target === null ? [] : [target]
  }

  /** Attaches a new session to the exact active target id. */
  attach(targetId: string): AgentDebugSessionDetail {
    const target = this.targets.getActive()
    if (target === null || target.targetId !== targetId) throw new Error('unknown or inactive Agent Debug target')
    return this.sessions.attach(target)
  }

  /** MCP-facing alias for attaching a debug session. */
  attachDebugSession(targetId: string): AgentDebugSessionDetail {
    return this.attach(targetId)
  }

  /** Explicitly detaches one session and cancels its pending work. */
  detach(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail {
    const session = this.sessions.detach(debugSessionId)
    if (session === null) throw new Error('unknown Agent Debug session')
    return session
  }

  /** MCP-facing idempotent detach alias; unknown sessions return null. */
  detachDebugSession(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail | null {
    try {
      return this.detach(debugSessionId)
    } catch (error) {
      if (error instanceof Error && error.message === 'unknown Agent Debug session') return null
      throw error
    }
  }

  /** Replaces the active target incarnation for Host reload/test seams. */
  replaceTarget(title = 'Cordis Runtime'): AgentDebugTarget {
    return this.targets.replace({
      metadata: { title, pluginVersion: null, cordisVersion: null },
      capabilities: AGENT_DEBUG_CAPABILITIES,
    })
  }

  /** Builds an exact-session metadata-only exploration snapshot. */
  snapshot(input: AgentDebugSnapshotInput): AgentDebugExplorationSnapshot {
    const session = this.requireActiveSession(input.debugSessionId)
    const sections = validateSections(input.sections)
    validateCatalogSelections(sections, input.catalogs)
    const projected = projectAgentDebugSnapshot({ observer: this.ports.snapshot(), profiler: this.ports.profilerSnapshot() })
    const snapshot = {
      generatedAt: this.now(),
      target: this.requireActiveTarget(),
      session,
      summary: sections.includes('summary') ? projected.summary : null,
      events: sections.includes('events') ? this.pageSection(input.debugSessionId, 'events', projected.events, input.catalogs?.events) : null,
      fibers: sections.includes('fibers') ? this.pageSection(input.debugSessionId, 'fibers', projected.fibers, input.catalogs?.fibers) : null,
      dispatches: sections.includes('dispatches') ? this.pageSection(input.debugSessionId, 'dispatches', projected.dispatches, input.catalogs?.dispatches) : null,
      profiler: sections.includes('profiler') ? projected.profiler : null,
      candidates: sections.includes('candidates') ? this.pageSection(input.debugSessionId, 'candidates', projected.candidates, input.catalogs?.candidates) : null,
    }
    const touched = this.sessions.touch(input.debugSessionId)
    if (touched === null) throw new Error('unknown Agent Debug session')
    return { ...snapshot, session: touched }
  }

  /** Alias named after the public Agent Debug operation. */
  debugSnapshot(input: AgentDebugSnapshotInput): AgentDebugExplorationSnapshot {
    return this.snapshot(input)
  }

  /** Waits for an exact metadata-only runtime observation from a session cursor. */
  waitForRuntimeChange(input: AgentDebugWaitForRuntimeChangeInput, signal?: AbortSignal): Promise<AgentDebugWaitForRuntimeChangeResult> {
    const session = this.requireActiveSession(input.debugSessionId)
    const afterSequence = input.afterSequence ?? session.observationSequence
    const sessionSignal = this.sessions.getAbortSignal(input.debugSessionId)
    const wait = this.journal.wait({
      afterSequence,
      type: input.type,
      event: input.event,
      timeoutMs: input.timeoutMs,
      signal: sessionSignal ?? undefined,
      onCancel: signal === undefined ? undefined : (cancel) => {
        if (signal.aborted) cancel()
        signal.addEventListener('abort', cancel, { once: true })
        return () => signal.removeEventListener('abort', cancel)
      },
    })
    return wait.then((result) => this.finishWait(input.debugSessionId, afterSequence, result))
  }

  /** Alias named after the concise public operation. */
  wait(input: AgentDebugWaitForRuntimeChangeInput, signal?: AbortSignal): Promise<AgentDebugWaitForRuntimeChangeResult> {
    return this.waitForRuntimeChange(input, signal)
  }

  /** Starts an experiment owned by the exact active debug session. */
  startAgent(
    debugSessionId: AgentDebugSessionId,
    source: WaterfallExperimentSource,
    input: WaterfallExperimentStartInput = {},
  ): WaterfallExperimentStartResult {
    this.requireActiveSession(debugSessionId)
    const result = this.ports.startAgent(source, input)
    if (result.outcome === 'started' && result.lease !== null) this.ownedLeases.set(result.lease.leaseId, debugSessionId)
    return result
  }

  /** Stops an Agent experiment only when its exact lease belongs to the session. */
  stopAgent(debugSessionId: AgentDebugSessionId, input: WaterfallExperimentStopInput): WaterfallExperimentStopResult {
    this.requireActiveSession(debugSessionId)
    if (this.ownedLeases.get(input.leaseId) !== debugSessionId) throw new Error('experiment lease is not owned by this Agent Debug session')
    const result = this.ports.stopAgent(input)
    if (result.outcome === 'stopped' || result.outcome === 'not-active' || result.outcome === 'conflict') this.ownedLeases.delete(input.leaseId)
    return result
  }

  /** Disposes sessions and owned leases before target, journal, and source state. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sessions.dispose()
    const target = this.targets.getActive()
    if (target !== null) this.appendTargetDisposed(target)
    this.unsubscribeNotifications()
    this.unsubscribeSessionEnd()
    this.unsubscribeTargetLifecycle()
    this.journal.dispose()
    this.targets.dispose()
    this.cursors.clear()
    this.ownedLeases.clear()
  }

  private requireActiveTarget(): AgentDebugTarget {
    const target = this.targets.getActive()
    if (target === null) throw new Error('Agent Debug target is not active')
    return target
  }

  private requireActiveSession(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail {
    const target = this.requireActiveTarget()
    const session = this.sessions.get(debugSessionId)
    if (session === null) throw new Error('unknown Agent Debug session')
    if (session.status !== 'active' || session.targetId !== target.targetId || session.targetEpoch !== target.targetEpoch) {
      throw new Error('Agent Debug session is stale or inactive')
    }
    return session
  }

  private pageSection<T>(sessionId: AgentDebugSessionId, section: CursorRecord['section'], items: readonly T[], input: AgentDebugCatalogInput | undefined): AgentDebugCatalog<T> {
    const cursor = input?.cursor
    if (cursor !== undefined) {
      const record = this.cursors.get(cursor)
      if (record === undefined || record.sessionId !== sessionId || record.section !== section) throw new Error('unknown or mismatched Agent Debug catalog cursor')
      const page = pageAgentDebugCatalog(record.items as readonly T[], { limit: input?.limit, cursor, offset: record.offset })
      this.cursors.delete(cursor)
      this.sessions.releaseCursor(sessionId)
      return this.finishCursorPage<T>(sessionId, section, page, record.items as readonly T[], record.offset)
    }

    const page = pageAgentDebugCatalog(items, { limit: input?.limit })
    return this.finishCursorPage(sessionId, section, page, items, 0)
  }

  private finishCursorPage<T>(sessionId: AgentDebugSessionId, section: CursorRecord['section'], page: AgentDebugCatalog<T>, items: readonly T[], offset: number): AgentDebugCatalog<T> {
    const nextOffset = offset + page.window.returned
    let nextCursor: AgentDebugCatalogCursor | null = null
    if (page.window.truncated) {
      if (!this.sessions.acquireCursor(sessionId)) throw new RangeError('maximum Agent Debug catalog cursors exceeded')
      nextCursor = this.createCursorId()
      this.cursors.set(nextCursor, { sessionId, section, items: [...items], offset: nextOffset })
    }
    return { ...page, window: { ...page.window, nextCursor } }
  }

  private createCursorId(): string {
    const create = this.cursorFactory
    let cursor = create()
    let attempts = 0
    while (this.cursors.has(cursor)) {
      if (++attempts >= 100) throw new Error('cursor factory did not produce a unique opaque id')
      cursor = create()
    }
    return cursor
  }

  private finishWait(sessionId: AgentDebugSessionId, afterSequence: number, result: AgentDebugJournalWaitResult): AgentDebugWaitForRuntimeChangeResult {
    const sequence = result.observation?.sequence ?? result.window.newestSequence ?? afterSequence
    const session = this.sessions.setObservationSequence(sessionId, sequence)
    if (session === null) throw new Error('unknown Agent Debug session')
    const touched = this.sessions.touch(sessionId)
    if (touched === null) throw new Error('unknown Agent Debug session')
    if (result.outcome === 'found') return { outcome: 'found', observation: result.observation, window: result.window, session: touched }
    if (result.outcome === 'gap') return { outcome: 'gap', observation: null, window: result.window, session: touched }
    return { outcome: 'timeout', observation: null, window: result.window, session: touched }
  }

  private appendNotification(notification: RuntimeNotification): void {
    if (this.disposed) return
    this.journal.append(notificationToObservation(notification, this.now()))
  }

  private appendTargetDisposed(target: AgentDebugTarget): void {
    try {
      this.journal.append({ type: 'target-disposed', observedAt: this.now(), targetId: target.targetId, targetEpoch: target.targetEpoch })
    } catch {
      // Disposal is intentionally idempotent; a journal already disposed by a
      // parent teardown must not turn target cleanup into a second failure.
    }
  }

  private releaseSessionResources(sessionId: AgentDebugSessionId): void {
    for (const [cursor, record] of this.cursors) {
      if (record.sessionId !== sessionId) continue
      this.cursors.delete(cursor)
      this.sessions.releaseCursor(sessionId)
    }
    for (const [leaseId, owner] of this.ownedLeases) {
      if (owner !== sessionId) continue
      this.ports.stopAgent({ leaseId })
      this.ownedLeases.delete(leaseId)
    }
  }
}

function validateSections(sections: readonly AgentDebugSnapshotSection[] | undefined): readonly AgentDebugSnapshotSection[] {
  const selected = sections ?? ALL_SECTIONS
  const known = new Set<AgentDebugSnapshotSection>(ALL_SECTIONS)
  if (new Set(selected).size !== selected.length || selected.some(section => !known.has(section))) throw new RangeError('invalid Agent Debug snapshot sections')
  return selected
}

function validateCatalogSelections(sections: readonly AgentDebugSnapshotSection[], catalogs: AgentDebugSnapshotInput['catalogs']): void {
  if (catalogs === undefined) return
  for (const section of Object.keys(catalogs)) {
    if (!ALL_SECTIONS.includes(section as AgentDebugSnapshotSection) || section === 'summary' || section === 'profiler' || !sections.includes(section as AgentDebugSnapshotSection)) {
      throw new RangeError(`catalog selection is invalid for section ${section}`)
    }
  }
}

/** Converts one raw Host fact into the journal's timestamped metadata union. */
function notificationToObservation(notification: RuntimeNotification, observedAt: number): AgentDebugObservationInput {
  switch (notification.type) {
    case 'dispatch-observed':
      return { ...notification, observedAt }
    case 'topology-invalidated':
      return { ...notification, observedAt }
    case 'profiler-trace-updated':
      return { ...notification, observedAt }
    case 'profiler-status-changed':
      return { ...notification, observedAt }
  }
}
