import {
  DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS,
  MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS,
} from '../../shared/agent-debug.js'
import type {
  AgentDebugObservation,
  AgentDebugObservationFilter,
  AgentDebugObservationSequence,
  AgentDebugObservationType,
  AgentDebugObservationWindow,
} from '../../shared/agent-debug.js'

export type AgentDebugObservationInput = AgentDebugObservation extends infer Observation
  ? Observation extends AgentDebugObservation
    ? Omit<Observation, 'sequence'>
    : never
  : never

export interface AgentDebugObservationJournalOptions {
  capacity: number
  maxWaiters: number
  now?: () => number
  defaultTimeoutMs?: number
}

export interface AgentDebugJournalWaitInput {
  afterSequence?: AgentDebugObservationSequence
  type?: AgentDebugObservationType
  event?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Register a cancellation callback, returning an unsubscribe function. */
  onCancel?: (cancel: () => void) => (() => void)
}

export type AgentDebugJournalWaitResult =
  | { outcome: 'found'; observation: AgentDebugObservation; window: AgentDebugObservationWindow }
  | { outcome: 'timeout'; observation: null; window: AgentDebugObservationWindow }
  | { outcome: 'gap'; observation: null; window: AgentDebugObservationWindow }

/** Error used when a wait is cancelled by a signal or session lifecycle. */
export class AgentDebugWaitCancelledError extends Error {
  constructor(message = 'Agent Debug observation wait was cancelled') {
    super(message)
    this.name = 'AgentDebugWaitCancelledError'
  }
}

interface Waiter {
  input: AgentDebugJournalWaitInput
  resolve: (result: AgentDebugJournalWaitResult) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
  abortListener?: () => void
  unsubscribeCancel?: () => void
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function validateTimeout(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS) {
    throw new RangeError(`${name} must be between 0 and ${MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS}`)
  }
}

/**
 * Stores metadata-only observations in a bounded target-local journal and
 * resolves exact-filter waits as soon as matching facts arrive.
 */
export class AgentDebugObservationJournal {
  private readonly capacity: number
  private readonly maxWaiters: number
  private readonly now: () => number
  private readonly defaultTimeoutMs: number
  private readonly observations: AgentDebugObservation[] = []
  private readonly waiters = new Set<Waiter>()
  private sequence = 0
  private truncated = false
  private disposed = false

  constructor(options: AgentDebugObservationJournalOptions) {
    validatePositiveInteger(options.capacity, 'capacity')
    validatePositiveInteger(options.maxWaiters, 'maxWaiters')
    const timeout = options.defaultTimeoutMs ?? DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS
    validateTimeout(timeout, 'defaultTimeoutMs')
    this.capacity = options.capacity
    this.maxWaiters = options.maxWaiters
    this.now = options.now ?? (() => Date.now())
    this.defaultTimeoutMs = timeout
  }

  /**
   * Appends one metadata-only observation, assigning the next monotonic
   * sequence and returning the exact retained representation.
   */
  append(input: AgentDebugObservationInput | AgentDebugObservation): AgentDebugObservation {
    if (this.disposed) throw new Error('Agent Debug observation journal is disposed')
    const observation = this.sanitize(input)
    this.sequence += 1
    const retained = { ...observation, sequence: this.sequence } as AgentDebugObservation
    if (this.observations.length === this.capacity) {
      this.observations.shift()
      this.truncated = true
    }
    this.observations.push(retained)
    this.resolveWaitersAfterAppend(retained)
    return { ...retained }
  }

  /**
   * Returns observations retained after the optional cursor, in sequence order.
   */
  read(afterSequence = 0, filter: AgentDebugObservationFilter = {}): AgentDebugObservation[] {
    return this.observations.filter((observation) => observation.sequence > afterSequence && matches(observation, filter)).map((observation) => ({ ...observation }))
  }

  /**
   * Returns the bounded retained window and whether a cursor has fallen behind it.
   */
  window(afterSequence?: AgentDebugObservationSequence): AgentDebugObservationWindow {
    const oldestSequence = this.observations[0]?.sequence ?? null
    const newestSequence = this.observations.at(-1)?.sequence ?? null
    const gap = afterSequence !== undefined && oldestSequence !== null && afterSequence < oldestSequence - 1
    return {
      bounded: true,
      oldestSequence,
      newestSequence,
      retained: this.observations.length,
      truncated: this.truncated,
      gap,
    }
  }

  /**
   * Waits for the first exact-filter match, timeout, or retained-window gap.
   * Cancellation rejects with AgentDebugWaitCancelledError.
   */
  wait(input: AgentDebugJournalWaitInput = {}): Promise<AgentDebugJournalWaitResult> {
    if (this.disposed) return Promise.reject(new AgentDebugWaitCancelledError('Agent Debug observation journal is disposed'))
    const afterSequence = input.afterSequence ?? 0
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      return Promise.reject(new RangeError('afterSequence must be a non-negative integer'))
    }
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs
    try {
      validateTimeout(timeoutMs, 'timeoutMs')
    } catch (error) {
      return Promise.reject(error)
    }
    const filter: AgentDebugObservationFilter = { type: input.type, event: input.event }
    const existing = this.read(afterSequence, filter)
    const window = this.window(afterSequence)
    if (window.gap) return Promise.resolve({ outcome: 'gap', observation: null, window })
    if (existing[0]) return Promise.resolve({ outcome: 'found', observation: existing[0], window })
    if (input.signal?.aborted) return Promise.reject(new AgentDebugWaitCancelledError())
    if (this.waiters.size >= this.maxWaiters) return Promise.reject(new RangeError('maximum Agent Debug waiters exceeded'))

    return new Promise<AgentDebugJournalWaitResult>((resolve, reject) => {
      let waiter!: Waiter
      waiter = {
        input: { ...input, afterSequence, timeoutMs },
        resolve,
        reject,
        timer: setTimeout(() => this.completeTimeout(waiter), timeoutMs),
      } as Waiter
      this.waiters.add(waiter)
      if (input.signal) {
        const abortListener = () => this.cancelWaiter(waiter)
        waiter.abortListener = abortListener
        input.signal.addEventListener('abort', abortListener, { once: true })
        if (input.signal.aborted) this.cancelWaiter(waiter)
      }
      if (input.onCancel) {
        const unsubscribe = input.onCancel(() => this.cancelWaiter(waiter))
        if (this.waiters.has(waiter)) waiter.unsubscribeCancel = unsubscribe
        else unsubscribe()
      }
    })
  }

  /**
   * Alias for wait, useful at integration boundaries that name the operation.
   */
  waitForObservation(input: AgentDebugJournalWaitInput = {}): Promise<AgentDebugJournalWaitResult> {
    return this.wait(input)
  }

  /**
   * Cancels all waiters and releases every timer and listener owned by the journal.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const waiter of [...this.waiters]) this.cancelWaiter(waiter, 'Agent Debug observation journal was disposed')
    this.observations.length = 0
  }

  /**
   * Returns the latest assigned target-local sequence.
   */
  get latestSequence(): AgentDebugObservationSequence {
    return this.sequence
  }

  /**
   * Returns the current number of retained observations and active waiters.
   */
  get sizes(): { retained: number; waiters: number } {
    return { retained: this.observations.length, waiters: this.waiters.size }
  }

  private sanitize(input: AgentDebugObservationInput | AgentDebugObservation): AgentDebugObservationInput {
    switch (input.type) {
      case 'dispatch-observed':
        return {
          type: input.type,
          observedAt: input.observedAt,
          dispatchId: input.dispatchId,
          event: input.event,
          mode: input.mode,
          argCount: input.argCount,
          registeredListeners: input.registeredListeners,
        }
      case 'topology-invalidated':
        return { type: input.type, observedAt: input.observedAt, reason: input.reason }
      case 'profiler-trace-updated':
        return { type: input.type, observedAt: input.observedAt, traceId: input.traceId, event: input.event }
      case 'profiler-status-changed':
        return { type: input.type, observedAt: input.observedAt, instrumentation: input.instrumentation }
      case 'target-disposed':
        return { type: input.type, observedAt: input.observedAt, targetId: input.targetId, targetEpoch: input.targetEpoch }
    }
  }

  private resolveWaitersAfterAppend(observation: AgentDebugObservation): void {
    for (const waiter of [...this.waiters]) {
      const afterSequence = waiter.input.afterSequence ?? 0
      if (observation.sequence > afterSequence && matches(observation, waiter.input)) {
        this.complete(waiter, { outcome: 'found', observation: { ...observation }, window: this.window(afterSequence) })
      } else if (this.window(afterSequence).gap) {
        this.complete(waiter, { outcome: 'gap', observation: null, window: this.window(afterSequence) })
      }
    }
  }

  private completeTimeout(waiter: Waiter): void {
    if (!this.waiters.has(waiter)) return
    const afterSequence = waiter.input.afterSequence ?? 0
    this.complete(waiter, { outcome: 'timeout', observation: null, window: this.window(afterSequence) })
  }

  private complete(waiter: Waiter, result: AgentDebugJournalWaitResult): void {
    if (!this.waiters.delete(waiter)) return
    clearTimeout(waiter.timer)
    if (waiter.input.signal && waiter.abortListener) waiter.input.signal.removeEventListener('abort', waiter.abortListener)
    waiter.unsubscribeCancel?.()
    waiter.resolve(result)
  }

  private cancelWaiter(waiter: Waiter, message?: string): void {
    if (!this.waiters.delete(waiter)) return
    clearTimeout(waiter.timer)
    if (waiter.input.signal && waiter.abortListener) waiter.input.signal.removeEventListener('abort', waiter.abortListener)
    waiter.unsubscribeCancel?.()
    waiter.reject(new AgentDebugWaitCancelledError(message))
  }
}

function matches(observation: AgentDebugObservation, filter: AgentDebugObservationFilter): boolean {
  if (filter.type !== undefined && observation.type !== filter.type) return false
  if (filter.event !== undefined) {
    if (!('event' in observation) || observation.event !== filter.event) return false
  }
  return true
}
