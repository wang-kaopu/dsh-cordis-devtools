export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall' | string

export interface FiberSnapshot {
  uid: number | null
  name: string
  state: string
}

export interface EffectSnapshot {
  label: string
  children: EffectSnapshot[]
}

export interface LiveFiberSnapshot extends FiberSnapshot {
  uid: number
  parent: FiberSnapshot | null
  inject: string[]
  effects: EffectSnapshot[]
}

export interface ListenerSnapshot {
  id: number
  event: string
  order: number
  prepend: boolean
  global: boolean
  owner: FiberSnapshot | null
}

export interface EventSnapshot {
  name: string
  listenerCount: number
  listenerIds: number[]
}

export interface DispatchRecord {
  id: number
  timestamp: number
  mode: DispatchMode
  event: string
  argCount: number
  registeredListeners: number
  thisFiber: FiberSnapshot | null
}

export interface DevtoolsSnapshot {
  generatedAt: number
  events: EventSnapshot[]
  listeners: ListenerSnapshot[]
  fibers: LiveFiberSnapshot[]
  dispatches: DispatchRecord[]
}

export interface CordisDevtoolsService {
  snapshot(): DevtoolsSnapshot
  clearDispatches(): void
  subscribe(listener: () => void): () => void
}
