import type {
  WaterfallDispatchTrace,
  WaterfallTraceReader,
  WaterfallTraceSink,
} from '../shared/trace.js'

export interface WaterfallTraceStoreOptions {
  maxTraces?: number
}

export class WaterfallTraceStore implements WaterfallTraceSink, WaterfallTraceReader {
  private readonly rows = new Map<string, WaterfallDispatchTrace>()
  private readonly maxTraces: number

  constructor(options: WaterfallTraceStoreOptions = {}) {
    const maxTraces = options.maxTraces ?? 200
    if (!Number.isInteger(maxTraces) || maxTraces <= 0) {
      throw new RangeError('maxTraces must be a positive integer')
    }
    this.maxTraces = maxTraces
  }

  write(trace: WaterfallDispatchTrace): void {
    const exists = this.rows.has(trace.id)
    this.rows.set(trace.id, cloneTrace(trace))
    if (exists) return

    while (this.rows.size > this.maxTraces) {
      const oldest = this.rows.keys().next().value
      if (oldest === undefined) break
      this.rows.delete(oldest)
    }
  }

  snapshot(): readonly WaterfallDispatchTrace[] {
    return [...this.rows.values()].map(cloneTrace)
  }

  get size(): number {
    return this.rows.size
  }
}

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
