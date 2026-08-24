import { Context } from '@deepseek-ai/cordis'
import type { FiberSnapshot } from '../../shared/types.js'
import type {
  WaterfallDispatchTrace,
  WaterfallListenerSpan,
  WaterfallNextCall,
  WaterfallTraceSink,
} from '../../shared/trace.js'

export type InstrumentationState = 'disabled' | 'enabled' | 'conflict' | 'unsupported'

type ListenerCallback = (...args: unknown[]) => unknown
type DispatchCallback = (...args: unknown[]) => unknown
type DispatchMethod = (type: string, args: unknown[]) => DispatchCallback[]

interface HookLike {
  ctx: Context
  callback: ListenerCallback
  global?: boolean
  prepend?: boolean
}

interface EventsLike {
  _hooks?: Record<PropertyKey, HookLike[]>
  dispatch: DispatchMethod
  emit(...args: unknown[]): void
}

export interface ListenerTraceMetadata {
  listenerId: string
  owner: FiberSnapshot | null
}

export interface WaterfallInstrumentationOptions {
  now?: () => number
  resolveListener?: (hook: object, event: string, order: number) => ListenerTraceMetadata
}

export class WaterfallInstrumentationController {
  private readonly events: EventsLike
  private readonly originalDispatch: DispatchMethod
  private readonly now: () => number
  private readonly listenerIds = new WeakMap<object, string>()
  private readonly resolveListener: (hook: object, event: string, order: number) => ListenerTraceMetadata
  private nextListenerId = 1
  private nextTraceId = 1
  private nextSpanId = 1
  private installedDispatch: DispatchMethod | null = null
  private stateValue: InstrumentationState = 'disabled'

  constructor(
    private readonly ctx: Context,
    private readonly sink: WaterfallTraceSink,
    options: WaterfallInstrumentationOptions = {},
  ) {
    this.events = ctx.events as unknown as EventsLike
    this.originalDispatch = this.events.dispatch
    this.now = options.now ?? (() => performance.now())
    this.resolveListener = options.resolveListener ?? ((hook) => this.defaultListenerMetadata(hook as HookLike))
  }

  get state(): InstrumentationState {
    return this.stateValue
  }

  enable(): boolean {
    if (this.stateValue === 'enabled') return true
    if (this.stateValue === 'conflict' || this.stateValue === 'unsupported') return false
    if (typeof this.events.dispatch !== 'function' || this.events._hooks == null) {
      this.stateValue = 'unsupported'
      return false
    }
    if (Object.prototype.hasOwnProperty.call(this.events, 'dispatch') || this.events.dispatch !== this.originalDispatch) {
      this.stateValue = 'conflict'
      return false
    }

    const controller = this
    const installed: DispatchMethod = function (this: EventsLike, type, args) {
      if (type !== 'waterfall') return controller.originalDispatch.call(this, type, args)
      return controller.dispatchWaterfall(args)
    }
    Object.defineProperty(this.events, 'dispatch', {
      configurable: true,
      writable: true,
      value: installed,
    })
    this.installedDispatch = installed
    this.stateValue = 'enabled'
    return true
  }

  disable(): boolean {
    if (this.stateValue === 'disabled') return true
    if (this.stateValue !== 'enabled' || this.installedDispatch === null) return false
    if (this.events.dispatch !== this.installedDispatch) {
      this.stateValue = 'conflict'
      return false
    }

    delete (this.events as unknown as { dispatch?: DispatchMethod }).dispatch
    this.installedDispatch = null
    this.stateValue = 'disabled'
    return true
  }

  private dispatchWaterfall(args: unknown[]): DispatchCallback[] {
    const startedAt = this.now()
    const thisArg = isObjectLike(args[0]) ? args.shift() : null
    const nameValue = args.shift()
    const name = String(nameValue)
    if (!name.startsWith('internal/')) {
      this.events.emit('internal/dispatch', 'waterfall', name, args, thisArg)
    }

    const filter = getFilter(thisArg)
    const hooks = this.events._hooks?.[name] ?? []
    const selected = hooks.filter(hook => hook.global === true || filter === undefined || filter.call(thisArg, hook.ctx))
    const trace: WaterfallDispatchTrace = {
      version: 1,
      id: `wf-${this.nextTraceId++}`,
      mode: 'waterfall',
      event: name,
      startedAt,
      returnedAt: null,
      settledAt: null,
      outcome: 'running',
      listeners: [],
    }
    this.publish(trace)

    return selected.map((hook, order) => {
      const target = hook.callback.bind(thisArg) as DispatchCallback
      const metadata = this.resolveListener(hook, name, order)
      return this.wrapListener(trace, target, metadata, order)
    })
  }

  private wrapListener(
    trace: WaterfallDispatchTrace,
    target: DispatchCallback,
    metadata: ListenerTraceMetadata,
    order: number,
  ): DispatchCallback {
    return (...args: unknown[]) => {
      const enteredAt = this.now()
      const span: WaterfallListenerSpan = {
        id: `wf-span-${this.nextSpanId++}`,
        listenerId: metadata.listenerId,
        owner: metadata.owner,
        order,
        enteredAt,
        returnedAt: null,
        settledAt: null,
        outcome: 'running',
        nextCalls: [],
      }
      trace.listeners.push(span)
      this.publish(trace)

      const callArgs = [...args]
      const originalNext = callArgs.at(-1)
      if (typeof originalNext === 'function') {
        callArgs[callArgs.length - 1] = this.wrapNext(trace, span, originalNext as () => unknown)
      }

      try {
        const result = target(...callArgs)
        const returnedAt = this.now()
        span.returnedAt = returnedAt
        if (isThenable(result)) {
          span.outcome = 'pending'
          if (order === 0) {
            trace.returnedAt = returnedAt
            trace.outcome = 'pending'
          }
          this.publish(trace)
          this.observeSettlement(result, (outcome, settledAt) => {
            span.settledAt = settledAt
            span.outcome = outcome
            if (order === 0) {
              trace.settledAt = settledAt
              trace.outcome = outcome
            }
            this.publish(trace)
          })
        } else {
          span.settledAt = returnedAt
          span.outcome = 'returned'
          if (order === 0) {
            trace.returnedAt = returnedAt
            trace.settledAt = returnedAt
            trace.outcome = 'returned'
          }
          this.publish(trace)
        }
        return result
      } catch (reason) {
        const settledAt = this.now()
        span.settledAt = settledAt
        span.outcome = 'threw'
        if (order === 0) {
          trace.settledAt = settledAt
          trace.outcome = 'threw'
        }
        this.publish(trace)
        throw reason
      }
    }
  }

  private wrapNext(
    trace: WaterfallDispatchTrace,
    span: WaterfallListenerSpan,
    originalNext: () => unknown,
  ): () => unknown {
    return () => {
      const call: WaterfallNextCall = {
        id: span.nextCalls.length,
        calledAt: this.now(),
        returnedAt: null,
        settledAt: null,
        outcome: 'running',
      }
      span.nextCalls.push(call)
      this.publish(trace)

      try {
        const result = originalNext()
        const returnedAt = this.now()
        call.returnedAt = returnedAt
        if (isThenable(result)) {
          call.outcome = 'pending'
          this.publish(trace)
          this.observeSettlement(result, (outcome, settledAt) => {
            call.settledAt = settledAt
            call.outcome = outcome
            this.publish(trace)
          })
        } else {
          call.settledAt = returnedAt
          call.outcome = 'returned'
          this.publish(trace)
        }
        return result
      } catch (reason) {
        call.settledAt = this.now()
        call.outcome = 'threw'
        this.publish(trace)
        throw reason
      }
    }
  }

  private observeSettlement(
    value: PromiseLike<unknown>,
    update: (outcome: 'fulfilled' | 'rejected', settledAt: number) => void,
  ): void {
    void Promise.resolve(value).then(
      () => { update('fulfilled', this.now()) },
      () => { update('rejected', this.now()) },
    )
  }

  private publish(trace: WaterfallDispatchTrace): void {
    this.sink.write(cloneTrace(trace))
  }

  private defaultListenerMetadata(hook: HookLike): ListenerTraceMetadata {
    let listenerId = this.listenerIds.get(hook)
    if (listenerId === undefined) {
      listenerId = `wf-listener-${this.nextListenerId++}`
      this.listenerIds.set(hook, listenerId)
    }
    return {
      listenerId,
      owner: snapshotFiber(hook.ctx),
    }
  }
}

function isObjectLike(value: unknown): value is object | Function {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function getFilter(value: unknown): ((target: Context) => boolean) | undefined {
  if (!isObjectLike(value)) return undefined
  const filter = (value as { [Context.filter]?: unknown })[Context.filter]
  return typeof filter === 'function' ? filter as (target: Context) => boolean : undefined
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (!isObjectLike(value)) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

function snapshotFiber(value: Context): FiberSnapshot | null {
  const fiber = value.fiber
  if (fiber == null) return null
  return {
    uid: typeof fiber.uid === 'number' || fiber.uid === null ? fiber.uid : null,
    name: typeof fiber.name === 'string' ? fiber.name : 'unknown',
    state: normalizeFiberState(fiber.state),
  }
}

function normalizeFiberState(state: unknown): string {
  if (typeof state !== 'number') return String(state ?? 'unknown')
  return ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'][state] ?? String(state)
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
