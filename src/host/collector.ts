import type { Context } from '@deepseek-ai/cordis'
import type {
  CordisDevtoolsService,
  DevtoolsSnapshot,
  DispatchMode,
  DispatchRecord,
  FiberSnapshot,
} from '../shared/types.js'
import { CordisAdapter } from './cordis-adapter.js'
import { RingBuffer } from './ring-buffer.js'

export interface CollectorOptions {
  maxDispatches?: number
}

export class ObserverCollector implements CordisDevtoolsService {
  private nextDispatchId = 1
  private readonly dispatches: RingBuffer<DispatchRecord>
  private readonly observedFibers = new Map<string, FiberSnapshot>()
  private readonly subscribers = new Set<() => void>()
  private readonly adapter: CordisAdapter

  constructor(
    private readonly ctx: Context,
    options: CollectorOptions = {},
  ) {
    this.adapter = new CordisAdapter(ctx)
    this.dispatches = new RingBuffer(options.maxDispatches ?? 500)
    this.seedFibersFromListeners()
    this.installObservers()
  }

  snapshot(): DevtoolsSnapshot {
    const listeners = this.adapter.snapshotListeners()
    for (const listener of listeners) this.rememberFiber(listener.owner)

    return {
      generatedAt: Date.now(),
      listeners,
      fibers: [...this.observedFibers.values()].sort(compareFibers),
      dispatches: this.dispatches.toArray(),
    }
  }

  clearDispatches(): void {
    this.dispatches.clear()
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  private installObservers(): void {
    const on = this.ctx.on.bind(this.ctx) as (
      event: string,
      listener: (...args: any[]) => unknown,
      options?: { global?: boolean; prepend?: boolean },
    ) => () => boolean

    on('internal/dispatch', (mode: DispatchMode, event: string, args: unknown[], thisArg: unknown) => {
      const thisFiber = this.adapter.snapshotFiber(thisArg)
      this.rememberFiber(thisFiber)
      this.dispatches.push({
        id: this.nextDispatchId++,
        timestamp: Date.now(),
        mode,
        event,
        argCount: Array.isArray(args) ? args.length : 0,
        registeredListeners: this.adapter.countRegisteredListeners(event),
        thisFiber,
      })
      this.notify()
    }, { global: true })

    on('internal/plugin', (fiber: unknown) => {
      this.rememberFiber(this.adapter.snapshotFiber(fiber))
      this.notify()
    }, { global: true })

    on('internal/status', (fiber: unknown) => {
      this.rememberFiber(this.adapter.snapshotFiber(fiber))
      this.notify()
    }, { global: true })

    on('internal/listener', () => {
      // Listener data is read live from ctx.events._hooks. This event only
      // invalidates consumers so future UIs can refresh without polling.
      this.notify()
    }, { global: true })
  }

  private seedFibersFromListeners(): void {
    for (const listener of this.adapter.snapshotListeners()) {
      this.rememberFiber(listener.owner)
    }
  }

  private rememberFiber(fiber: FiberSnapshot | null): void {
    if (fiber == null) return
    this.observedFibers.set(fiberKey(fiber), fiber)
  }

  private notify(): void {
    for (const subscriber of this.subscribers) subscriber()
  }
}

function fiberKey(fiber: FiberSnapshot): string {
  return fiber.uid == null ? `name:${fiber.name}` : `uid:${fiber.uid}`
}

function compareFibers(a: FiberSnapshot, b: FiberSnapshot): number {
  if (a.uid == null && b.uid == null) return a.name.localeCompare(b.name)
  if (a.uid == null) return 1
  if (b.uid == null) return -1
  return a.uid - b.uid
}
