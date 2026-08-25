import {
  DEFAULT_AGENT_DEBUG_CATALOG_LIMIT,
  MAX_AGENT_DEBUG_CATALOG_LIMIT,
  type AgentDebugCatalog,
  type AgentDebugCatalogInput,
  type AgentDebugDispatchCatalogEntry,
  type AgentDebugEventCatalogEntry,
  type AgentDebugFiberCatalogEntry,
  type AgentDebugMechanicalCandidate,
  type AgentDebugProfilerCatalogEntry,
  type AgentDebugRuntimeSummary,
} from '../../shared/agent-debug.js'
import type { DevtoolsSnapshot, ListenerSnapshot } from '../../shared/types.js'
import type { WaterfallDispatchTrace, WaterfallProfilerSnapshot } from '../../shared/trace.js'

/** A local page input used by the pure projection layer before session cursors exist. */
export interface AgentDebugCatalogPageInput extends AgentDebugCatalogInput {
  /** Resolved offset supplied by a session-owned cursor registry. */
  offset?: number
}

/** The authoritative observer and profiler facts needed to build Agent catalogs. */
export interface AgentDebugSnapshotProjectionInput {
  observer: DevtoolsSnapshot
  profiler: WaterfallProfilerSnapshot
}

/**
 * Projects bounded runtime counts from authoritative observer and profiler snapshots.
 *
 * @param observer - Current metadata-only Cordis observer snapshot.
 * @param profiler - Current metadata-only profiler snapshot.
 * @returns Runtime counts with the newest source generation timestamp.
 */
export function projectAgentDebugRuntimeSummary(
  observer: DevtoolsSnapshot,
  profiler: WaterfallProfilerSnapshot,
): AgentDebugRuntimeSummary {
  return {
    generatedAt: Math.max(observer.generatedAt, profiler.generatedAt),
    events: observer.events.length,
    listeners: observer.listeners.length,
    liveFibers: observer.fibers.length,
    dispatchesRetained: observer.dispatches.length,
    tracesRetained: profiler.traces.length,
  }
}

/**
 * Projects the stable Event catalog, sorted by Event name.
 *
 * @param observer - Current metadata-only Cordis observer snapshot.
 * @returns Event entries detached from the source snapshot.
 */
export function projectAgentDebugEventCatalog(observer: DevtoolsSnapshot): AgentDebugEventCatalogEntry[] {
  return observer.events
    .map(event => ({ name: event.name, listenerCount: event.listenerCount }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Projects the live Fiber catalog, sorted by name and then capture-local uid.
 *
 * @param observer - Current metadata-only Cordis observer snapshot.
 * @returns Fiber entries with listener/event ownership counts.
 */
export function projectAgentDebugFiberCatalog(observer: DevtoolsSnapshot): AgentDebugFiberCatalogEntry[] {
  return observer.fibers
    .map(fiber => {
      const ownedListeners = observer.listeners.filter(listener => listener.owner?.uid === fiber.uid)
      const ownedEvents = new Set(ownedListeners.map(listener => listener.event))
      return {
        uid: fiber.uid,
        name: fiber.name,
        state: fiber.state,
        parentUid: fiber.parent?.uid ?? null,
        ownedListenerCount: ownedListeners.length,
        ownedEventCount: ownedEvents.size,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.uid - right.uid)
}

/**
 * Projects recent dispatches newest-first using timestamp and id as stable tie-breakers.
 *
 * @param observer - Current metadata-only Cordis observer snapshot.
 * @returns Dispatch overview entries detached from the source snapshot.
 */
export function projectAgentDebugDispatchCatalog(observer: DevtoolsSnapshot): AgentDebugDispatchCatalogEntry[] {
  return observer.dispatches
    .map(dispatch => ({
      dispatchId: dispatch.id,
      timestamp: dispatch.timestamp,
      event: dispatch.event,
      mode: dispatch.mode,
      registeredListeners: dispatch.registeredListeners,
    }))
    .sort((left, right) => right.timestamp - left.timestamp || right.dispatchId - left.dispatchId)
}

/**
 * Projects the current profiler instrumentation state and retained trace count.
 *
 * @param profiler - Current metadata-only profiler snapshot.
 * @returns Profiler status detached from the source snapshot.
 */
export function projectAgentDebugProfilerCatalog(profiler: WaterfallProfilerSnapshot): AgentDebugProfilerCatalogEntry {
  return {
    instrumentation: profiler.instrumentation,
    traceCount: profiler.traces.length,
  }
}

/**
 * Applies a bounded page to a catalog. Cursor values are intentionally opaque: this layer
 * only accepts a resolved offset and preserves the incoming cursor as window metadata.
 *
 * @param items - Stable, already-projected catalog entries.
 * @param input - Optional limit, opaque cursor, and session-resolved offset.
 * @returns A detached page with explicit bounded-window facts.
 */
export function pageAgentDebugCatalog<T>(items: readonly T[], input: AgentDebugCatalogPageInput = {}): AgentDebugCatalog<T> {
  const limit = normalizeCatalogLimit(input.limit)
  const offset = normalizeCatalogOffset(input.offset, items.length)
  const returnedItems = items.slice(offset, offset + limit)
  const nextOffset = offset + returnedItems.length

  return {
    items: returnedItems,
    window: {
      bounded: true,
      limit,
      returned: returnedItems.length,
      total: items.length,
      truncated: nextOffset < items.length,
      cursor: input.cursor ?? null,
      // Cursor registries belong to the session/core layer, not this pure projection.
      nextCursor: null,
    },
  }
}

/**
 * Projects factual mechanical candidates from live topology and retained waterfall traces.
 *
 * @param observer - Current metadata-only Cordis observer snapshot.
 * @param profiler - Current metadata-only profiler snapshot.
 * @returns Stable candidates sorted by kind and key.
 */
export function projectAgentDebugMechanicalCandidates(
  observer: DevtoolsSnapshot,
  profiler: WaterfallProfilerSnapshot,
): AgentDebugMechanicalCandidate[] {
  const candidates = [
    ...duplicateFiberCandidates(observer),
    ...equivalentListenerCandidates(observer),
    ...orphanedListenerCandidates(observer),
    ...traceNextCandidates(profiler.traces),
    ...instrumentationCandidates(profiler),
  ]
  return candidates.sort((left, right) => left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key))
}

/**
 * Projects every snapshot catalog in one pure operation; callers attach target/session metadata.
 *
 * @param input - Authoritative observer and profiler snapshots.
 * @returns Stable unpaged catalogs, summary, and mechanical candidates.
 */
export function projectAgentDebugSnapshot(input: AgentDebugSnapshotProjectionInput) {
  const { observer, profiler } = input
  return {
    summary: projectAgentDebugRuntimeSummary(observer, profiler),
    events: projectAgentDebugEventCatalog(observer),
    fibers: projectAgentDebugFiberCatalog(observer),
    dispatches: projectAgentDebugDispatchCatalog(observer),
    profiler: projectAgentDebugProfilerCatalog(profiler),
    candidates: projectAgentDebugMechanicalCandidates(observer, profiler),
  }
}

function normalizeCatalogLimit(limit: number | undefined): number {
  const normalized = limit ?? DEFAULT_AGENT_DEBUG_CATALOG_LIMIT
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_AGENT_DEBUG_CATALOG_LIMIT) {
    throw new RangeError(`catalog limit must be an integer between 1 and ${MAX_AGENT_DEBUG_CATALOG_LIMIT}`)
  }
  return normalized
}

function normalizeCatalogOffset(offset: number | undefined, total: number): number {
  const normalized = offset ?? 0
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > total) {
    throw new RangeError('catalog offset must be an integer between 0 and the catalog total')
  }
  return normalized
}

function duplicateFiberCandidates(observer: DevtoolsSnapshot): AgentDebugMechanicalCandidate[] {
  const counts = countBy(observer.fibers, fiber => fiber.name)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => candidate('duplicate-live-fibers', name, count, [{ field: 'name', value: name }]))
}

function equivalentListenerCandidates(observer: DevtoolsSnapshot): AgentDebugMechanicalCandidate[] {
  const counts = new Map<string, { count: number; facts: AgentDebugMechanicalCandidate['evidence'] }>()
  for (const listener of observer.listeners) {
    const descriptor = listenerDescriptor(listener)
    const key = canonicalStringify(descriptor)
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { count: 1, facts: listenerFacts(listener) })
  }
  return [...counts.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => candidate('equivalent-listener-registrations', key, group.count, group.facts))
}

function orphanedListenerCandidates(observer: DevtoolsSnapshot): AgentDebugMechanicalCandidate[] {
  const liveUids = new Set(observer.fibers.map(fiber => fiber.uid))
  const groups = new Map<string, { count: number; facts: AgentDebugMechanicalCandidate['evidence'] }>()
  for (const listener of observer.listeners) {
    const owner = listener.owner
    if (owner === null || owner.uid === null || liveUids.has(owner.uid)) continue
    const facts = [
      { field: 'event', value: listener.event },
      { field: 'ownerUid', value: owner.uid },
      { field: 'ownerName', value: owner.name },
    ] satisfies AgentDebugMechanicalCandidate['evidence']
    const key = `${listener.event}\u0000${owner.uid}\u0000${owner.name}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { count: 1, facts })
  }
  return [...groups.entries()].map(([key, group]) => candidate('orphaned-listener-owner', key, group.count, group.facts))
}

function traceNextCandidates(traces: readonly WaterfallDispatchTrace[]): AgentDebugMechanicalCandidate[] {
  const candidates: AgentDebugMechanicalCandidate[] = []
  for (const trace of traces) {
    for (const listener of trace.listeners) {
      const repeatedNextCalls = listener.nextCalls.length > 1 ? listener.nextCalls.length : 0
      const returnedAt = listener.returnedAt
      const lateNextCalls = returnedAt === null
        ? 0
        : listener.nextCalls.filter(next => next.calledAt > returnedAt).length
      if (repeatedNextCalls === 0 && lateNextCalls === 0) continue
      const facts = [
        { field: 'traceId', value: trace.id },
        { field: 'event', value: trace.event },
        { field: 'listenerId', value: listener.listenerId },
        { field: 'repeatedNextCalls', value: repeatedNextCalls },
        { field: 'lateNextCalls', value: lateNextCalls },
      ] satisfies AgentDebugMechanicalCandidate['evidence']
      candidates.push(candidate('trace-next-anomaly', `${trace.id}\u0000${listener.listenerId}`, Math.max(repeatedNextCalls, lateNextCalls), facts))
    }
  }
  return candidates
}

function instrumentationCandidates(profiler: WaterfallProfilerSnapshot): AgentDebugMechanicalCandidate[] {
  if (profiler.instrumentation !== 'conflict' && profiler.instrumentation !== 'unsupported') return []
  return [candidate('instrumentation-conflict', profiler.instrumentation, 1, [{ field: 'instrumentation', value: profiler.instrumentation }])]
}

function candidate(
  kind: AgentDebugMechanicalCandidate['kind'],
  key: string,
  count: number,
  evidence: AgentDebugMechanicalCandidate['evidence'],
): AgentDebugMechanicalCandidate {
  return { kind, key, count, evidence: evidence.map(fact => ({ ...fact })) }
}

function listenerDescriptor(listener: ListenerSnapshot) {
  return {
    event: listener.event,
    ownerName: listener.owner?.name ?? null,
    prepend: listener.prepend,
    global: listener.global,
  }
}

function listenerFacts(listener: ListenerSnapshot): AgentDebugMechanicalCandidate['evidence'] {
  const descriptor = listenerDescriptor(listener)
  return [
    { field: 'event', value: descriptor.event },
    { field: 'ownerName', value: descriptor.ownerName },
    { field: 'prepend', value: descriptor.prepend },
    { field: 'global', value: descriptor.global },
  ]
}

function countBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(keyOf(value), (counts.get(keyOf(value)) ?? 0) + 1)
  return counts
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort((a, b) => a.localeCompare(b)).map(key => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(',')}}`
}
