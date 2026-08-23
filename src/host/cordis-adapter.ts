import type { Context } from '@deepseek-ai/cordis'
import type { FiberSnapshot, ListenerSnapshot } from '../shared/types.js'

interface FiberLike {
  uid?: number | null
  name?: string
  state?: unknown
}

interface ContextLike {
  fiber?: FiberLike
}

interface HookLike {
  ctx?: ContextLike
  callback?: (...args: unknown[]) => unknown
  prepend?: boolean
  global?: boolean
}

interface EventsLike {
  _hooks?: Record<PropertyKey, HookLike[]>
}

/**
 * All direct access to Cordis diagnostic internals lives in this adapter.
 * The collector itself only consumes serializable snapshots returned here.
 */
export class CordisAdapter {
  private nextListenerId = 1
  private readonly listenerIds = new WeakMap<object, number>()

  constructor(private readonly ctx: Context) {}

  snapshotListeners(): ListenerSnapshot[] {
    const hooks = (this.ctx.events as unknown as EventsLike)._hooks
    if (hooks == null) return []

    const result: ListenerSnapshot[] = []
    for (const event of Reflect.ownKeys(hooks)) {
      const eventHooks = hooks[event] ?? []
      eventHooks.forEach((hook, order) => {
        result.push({
          id: this.listenerId(hook),
          event: String(event),
          order,
          prepend: hook.prepend === true,
          global: hook.global === true,
          owner: this.snapshotFiber(hook.ctx),
        })
      })
    }
    return result
  }

  countRegisteredListeners(event: string): number {
    const hooks = (this.ctx.events as unknown as EventsLike)._hooks
    return hooks?.[event]?.length ?? 0
  }

  snapshotFiber(value: unknown): FiberSnapshot | null {
    const fiber = this.fiberOf(value)
    if (fiber == null) return null
    return {
      uid: typeof fiber.uid === 'number' || fiber.uid === null ? fiber.uid : null,
      name: typeof fiber.name === 'string' ? fiber.name : 'unknown',
      state: String(fiber.state ?? 'unknown'),
    }
  }

  private fiberOf(value: unknown): FiberLike | null {
    if (value == null || (typeof value !== 'object' && typeof value !== 'function')) return null
    const candidate = value as ContextLike & FiberLike
    if (candidate.fiber != null) return candidate.fiber
    if ('uid' in candidate || 'state' in candidate) return candidate
    return null
  }

  private listenerId(hook: HookLike): number {
    const known = this.listenerIds.get(hook)
    if (known != null) return known
    const id = this.nextListenerId++
    this.listenerIds.set(hook, id)
    return id
  }
}
