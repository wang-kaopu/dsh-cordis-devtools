import { createElement, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { EventExplorerAction } from './EventExplorer.js'
import { createSnapshotPort, type ClientConnectionLike } from './port.js'
import { createProfilerPort } from './profiler-port.js'
import { EventExplorerStore } from './store.js'
import { ProfilerStore } from './profiler-store.js'

interface ClientSlotsLike {
  inject(name: string, callback: () => unknown): unknown
  register(
    options: {
      name: string
      id?: string
      order?: number
      label?: string
    },
    component: (props: { wide: boolean }) => ReactNode,
  ): unknown
}

export const name = 'dsh-cordis-devtools'
export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const connection = requireService<ClientConnectionLike>(ctx, 'connection')
  const slots = requireService<ClientSlotsLike>(ctx, 'slots')
  const store = new EventExplorerStore(createSnapshotPort(connection))
  const profilerStore = new ProfilerStore(createProfilerPort(connection))

  ctx.effect(() => () => {
    profilerStore.dispose()
    store.dispose()
  }, 'dsh-cordis-devtools: dispose client stores')

  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'cordis-devtools',
    order: 100,
    label: 'Cordis DevTools',
  }, props => createElement(EventExplorerAction, {
    wide: props.wide,
    store,
    profilerStore,
  })))
}

function requireService<T>(ctx: Context, name: string): T {
  const service = ctx.get(name)
  if (service === undefined || service === null) {
    throw new Error(`dsh-cordis-devtools client: required service ${JSON.stringify(name)} is unavailable`)
  }
  return service as T
}
