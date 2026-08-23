import type { Context } from '@deepseek-ai/cordis'
import type {
  CordisDevtoolsService,
  DevtoolsSnapshot,
  DispatchMode,
  DispatchRecord,
  EventSnapshot,
  ListenerSnapshot,
} from '../shared/types.js'
import { CordisAdapter } from './cordis-adapter.js'
import { RingBuffer } from './ring-buffer.js'

export interface CollectorOptions {
  maxDispatches?: number
}

export class ObserverCollector implements CordisDevtoolsService {
  private nextDispatchId = 1
  private readonly dispatches: RingBuffer<DispatchRecord>
  private readonly subscribers = new Set<() => void>()
  private readonly adapter: CordisAdapter
  private listenerNotificationQueued = false
  private pluginNotificationQueued = false

  constructor(
    private readonly ctx: Context,
    options: CollectorOptions = {},
  ) {
    this.adapter = new CordisAdapter(ctx)
    this.dispatches = new RingBuffer(options.maxDispatches ?? 500)
    this.installObservers()
  }

  snapshot(): DevtoolsSnapshot {
    const listeners = this.adapter.snapshotListeners()

    return {
      generatedAt: Date.now(),
      events: buildEventSnapshots(listeners),
      listeners,
      fibers: this.adapter.snapshotFibers(),
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

    on('internal/plugin', () => {
      // A disposing fiber has its uid cleared before Cordis removes it from
      // runtime.fibers. Defer the invalidation so subscriber refreshes happen
      // after the registry mutation settles in the current turn.
      this.schedulePluginNotification()
    }, { global: true })

    on('internal/status', () => {
      this.notify()
    }, { global: true })

    on('internal/listener', () => {
      // Cordis emits internal/listener before storing the hook in _hooks.
      // Defer invalidation so a subscriber refreshing from the live registry
      // observes the completed registration rather than the pre-insert state.
      this.scheduleListenerNotification()
    }, { global: true })
  }

  private scheduleListenerNotification(): void {
    if (this.listenerNotificationQueued) return
    this.listenerNotificationQueued = true
    queueMicrotask(() => {
      this.listenerNotificationQueued = false
      this.notify()
    })
  }

  private schedulePluginNotification(): void {
    if (this.pluginNotificationQueued) return
    this.pluginNotificationQueued = true
    queueMicrotask(() => {
      this.pluginNotificationQueued = false
      this.notify()
    })
  }

  private notify(): void {
    for (const subscriber of this.subscribers) subscriber()
  }
}

function buildEventSnapshots(listeners: ListenerSnapshot[]): EventSnapshot[] {
  const listenerIdsByEvent = new Map<string, number[]>()
  for (const listener of listeners) {
    let ids = listenerIdsByEvent.get(listener.event)
    if (ids == null) {
      ids = []
      listenerIdsByEvent.set(listener.event, ids)
    }
    ids.push(listener.id)
  }

  return [...listenerIdsByEvent.entries()]
    .map(([name, listenerIds]) => ({
      name,
      listenerCount: listenerIds.length,
      listenerIds,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
