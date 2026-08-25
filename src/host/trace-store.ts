import type {
  WaterfallDispatchTrace,
  WaterfallTraceReader,
  WaterfallTraceSink,
} from '../shared/trace.js'
import type { RuntimeNotificationSource } from './runtime-notifications.js'

/** Options controlling bounded waterfall trace retention and notifications. */
export interface WaterfallTraceStoreOptions {
  /** Maximum number of trace ids retained in insertion order. */
  maxTraces?: number
  /** Optional host-local fan-out for metadata-only trace update facts. */
  runtimeNotifications?: RuntimeNotificationSource
}

/** Stores cloned, bounded waterfall traces and optionally publishes update facts. */
export class WaterfallTraceStore implements WaterfallTraceSink, WaterfallTraceReader {
  private readonly rows = new Map<string, WaterfallDispatchTrace>()
  private readonly maxTraces: number
  private readonly runtimeNotifications?: RuntimeNotificationSource

  /**
   * Creates a bounded trace store.
   *
   * @param options - Retention and optional notification configuration
   */
  constructor(options: WaterfallTraceStoreOptions = {}) {
    const maxTraces = options.maxTraces ?? 200
    if (!Number.isInteger(maxTraces) || maxTraces <= 0) {
      throw new RangeError('maxTraces must be a positive integer')
    }
    this.maxTraces = maxTraces
    this.runtimeNotifications = options.runtimeNotifications
  }

  /**
   * Upserts a cloned trace and publishes its metadata after retention settles.
   *
   * @param trace - Latest serializable state for one dispatch trace
   */
  write(trace: WaterfallDispatchTrace): void {
    const exists = this.rows.has(trace.id)
    this.rows.set(trace.id, cloneTrace(trace))
    if (!exists) {
      while (this.rows.size > this.maxTraces) {
        const oldest = this.rows.keys().next().value
        if (oldest === undefined) break
        this.rows.delete(oldest)
      }
    }

    // Consumers must observe the cloned row and final bounded window when
    // they synchronously query the store from their notification callback.
    this.runtimeNotifications?.publish({
      type: 'profiler-trace-updated',
      traceId: trace.id,
      event: trace.event,
    })
  }

  /**
   * Returns cloned traces in insertion order.
   *
   * @returns Current bounded trace snapshots
   */
  snapshot(): readonly WaterfallDispatchTrace[] {
    return [...this.rows.values()].map(cloneTrace)
  }

  /** Number of trace ids currently retained. */
  get size(): number {
    return this.rows.size
  }
}

/**
 * Clones a trace without retaining mutable listener or owner references.
 *
 * @param trace - Trace snapshot to clone
 * @returns An independent trace snapshot
 */
function cloneTrace(trace: WaterfallDispatchTrace): WaterfallDispatchTrace {
  return {
    ...trace,
    listeners: trace.listeners.map(listener => ({
      ...listener,
      owner: listener.owner === null ? null : { ...listener.owner },
      nextCalls: listener.nextCalls.map(call => ({ ...call })),
    })),
  }
}
