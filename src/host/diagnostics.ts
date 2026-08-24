import type {
  RuntimeDiagnosticsSummary,
  RuntimeDispatchSearchInput,
  RuntimeDispatchSearchResult,
  RuntimeEventInspection,
  RuntimeFiberDetail,
  RuntimeFiberInspection,
  RuntimeFiberSelector,
  RuntimeProfilerTraceSearchInput,
  RuntimeProfilerTraceSearchResult,
} from '../shared/diagnostics.js'
import type { WaterfallExperimentStatus } from '../shared/experiments.js'
import type { DevtoolsSnapshot } from '../shared/types.js'
import type { WaterfallProfilerSnapshot } from '../shared/trace.js'
import {
  RUNTIME_CHECKPOINT_SCHEMA_VERSION,
  type RuntimeCheckpoint,
  type RuntimeCheckpointCaptureInput,
  type RuntimeCheckpointCompareInput,
  type RuntimeCheckpointComparison,
} from '../shared/verification.js'
import {
  captureRuntimeCheckpoint,
  computeRuntimeCheckpointDigest,
} from './verification/checkpoint.js'
import { compareRuntimeCheckpoints } from './verification/diff.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export interface RuntimeDiagnosticsSource {
  snapshot(): DevtoolsSnapshot
  profilerSnapshot(): WaterfallProfilerSnapshot
  /** v0.6+ Host ownership facts; optional keeps pure v0.4/v0.5 fixtures usable. */
  waterfallExperimentStatus?(): WaterfallExperimentStatus
}

export class RuntimeDiagnosticsQuery {
  constructor(private readonly source: RuntimeDiagnosticsSource) {}

  runtimeSummary(): RuntimeDiagnosticsSummary {
    const observer = this.source.snapshot()
    const profiler = this.source.profilerSnapshot()

    return {
      generatedAt: Math.max(observer.generatedAt, profiler.generatedAt),
      events: observer.events.length,
      listeners: observer.listeners.length,
      liveFibers: observer.fibers.length,
      dispatchWindow: {
        bounded: true,
        retained: observer.dispatches.length,
      },
      profiler: {
        instrumentation: profiler.instrumentation,
        traces: {
          bounded: true,
          retained: profiler.traces.length,
        },
      },
    }
  }

  waterfallExperimentStatus(): WaterfallExperimentStatus {
    const status = this.source.waterfallExperimentStatus?.()
    if (status === undefined) {
      throw new Error('waterfall experiment status is unavailable from this diagnostics source')
    }
    return {
      generatedAt: status.generatedAt,
      instrumentation: status.instrumentation,
      owner: { ...status.owner },
    }
  }

  inspectEvent(name: string): RuntimeEventInspection {
    const snapshot = this.source.snapshot()
    const liveUids = new Set(snapshot.fibers.map(fiber => fiber.uid))
    const listeners = snapshot.listeners
      .filter(listener => listener.event === name)
      .map(listener => ({
        ...listener,
        owner: listener.owner === null ? null : { ...listener.owner },
        ownerLive: listener.owner?.uid != null && liveUids.has(listener.owner.uid),
      }))
      .sort((a, b) => a.order - b.order || a.id - b.id)

    return {
      generatedAt: snapshot.generatedAt,
      name,
      found: snapshot.events.some(event => event.name === name),
      listenerCount: listeners.length,
      listeners,
    }
  }

  inspectFiber(selector: RuntimeFiberSelector): RuntimeFiberInspection {
    const normalized = normalizeFiberSelector(selector)
    const snapshot = this.source.snapshot()
    const matches = snapshot.fibers
      .filter(fiber => normalized.uid !== undefined ? fiber.uid === normalized.uid : fiber.name === normalized.name)
      .map(fiber => this.describeFiber(snapshot, fiber))
      .sort((a, b) => a.uid - b.uid)

    return {
      generatedAt: snapshot.generatedAt,
      selector: normalized,
      matches,
    }
  }

  searchDispatches(input: RuntimeDispatchSearchInput = {}): RuntimeDispatchSearchResult {
    const snapshot = this.source.snapshot()
    const limit = normalizeLimit(input.limit)
    const matches = snapshot.dispatches
      .filter(record => input.event === undefined || record.event === input.event)
      .filter(record => input.fiberUid === undefined || record.thisFiber?.uid === input.fiberUid)
      .filter(record => input.mode === undefined || record.mode === input.mode)
      .reverse()
    const records = matches.slice(0, limit).map(record => ({
      ...record,
      thisFiber: record.thisFiber === null ? null : { ...record.thisFiber },
    }))

    return {
      generatedAt: snapshot.generatedAt,
      records,
      window: {
        bounded: true,
        retained: snapshot.dispatches.length,
        matched: matches.length,
        returned: records.length,
        truncated: matches.length > records.length,
      },
    }
  }

  profilerTraces(input: RuntimeProfilerTraceSearchInput = {}): RuntimeProfilerTraceSearchResult {
    const snapshot = this.source.profilerSnapshot()
    const limit = normalizeLimit(input.limit)
    const matches = snapshot.traces
      .filter(trace => input.event === undefined || trace.event === input.event)
      .filter(trace => input.experimentId === undefined || trace.experimentId === input.experimentId)
      .slice()
      .reverse()
    const traces = matches.slice(0, limit).map(trace => ({
      ...trace,
      listeners: trace.listeners.map(listener => ({
        ...listener,
        owner: listener.owner === null ? null : { ...listener.owner },
        nextCalls: listener.nextCalls.map(call => ({ ...call })),
      })),
    }))

    return {
      generatedAt: snapshot.generatedAt,
      instrumentation: snapshot.instrumentation,
      traces,
      window: {
        bounded: true,
        retained: snapshot.traces.length,
        matched: matches.length,
        returned: traces.length,
        truncated: matches.length > traces.length,
      },
    }
  }

  captureCheckpoint(input: RuntimeCheckpointCaptureInput = {}): RuntimeCheckpoint {
    return captureRuntimeCheckpoint(this.source.snapshot(), input)
  }

  compareCurrent(input: RuntimeCheckpointCompareInput): RuntimeCheckpointComparison {
    const baseline = input?.baseline
    if (!baseline) throw new TypeError('compareCurrent requires a baseline checkpoint')
    if (baseline.schemaVersion !== RUNTIME_CHECKPOINT_SCHEMA_VERSION) {
      throw new RangeError(`Unsupported baseline checkpoint schema version: ${baseline.schemaVersion}`)
    }
    if (computeRuntimeCheckpointDigest(baseline) !== baseline.digest) {
      throw new TypeError('baseline checkpoint digest does not match checkpoint body')
    }

    const current = captureRuntimeCheckpoint(this.source.snapshot(), { scope: baseline.scope })
    return compareRuntimeCheckpoints(baseline, current)
  }

  private describeFiber(snapshot: DevtoolsSnapshot, fiber: DevtoolsSnapshot['fibers'][number]): RuntimeFiberDetail {
    const ownedListeners = snapshot.listeners.filter(listener => listener.owner?.uid === fiber.uid)
    const ownedEvents = [...new Set(ownedListeners.map(listener => listener.event))].sort((a, b) => a.localeCompare(b))

    return {
      ...fiber,
      parent: fiber.parent === null ? null : { ...fiber.parent },
      inject: [...fiber.inject],
      effects: fiber.effects.map(cloneEffect),
      ownedListenerIds: ownedListeners.map(listener => listener.id),
      ownedEvents,
      recentDispatchContextHits: snapshot.dispatches.filter(record => record.thisFiber?.uid === fiber.uid).length,
    }
  }
}

function cloneEffect(effect: DevtoolsSnapshot['fibers'][number]['effects'][number]): typeof effect {
  return {
    label: effect.label,
    children: effect.children.map(cloneEffect),
  }
}

function normalizeFiberSelector(selector: RuntimeFiberSelector): RuntimeFiberSelector {
  const uid = selector.uid
  const name = selector.name
  if ((uid === undefined) === (name === undefined)) {
    throw new TypeError('inspectFiber requires exactly one of uid or name')
  }
  if (uid !== undefined) {
    if (!Number.isInteger(uid) || uid < 0) throw new RangeError('fiber uid must be a non-negative integer')
    return { uid }
  }
  if (name === undefined || name.trim() === '') throw new TypeError('fiber name must not be empty')
  return { name }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  }
  return limit
}
