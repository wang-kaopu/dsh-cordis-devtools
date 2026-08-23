import type { Context } from '@deepseek-ai/cordis'
import { ObserverCollector } from './host/collector.js'
import { installDevtoolsRpc } from './host/rpc.js'

export const name = 'dsh-cordis-devtools'
export const provide = 'cordisDevtools'

export interface Config {
  /** Maximum number of recent dispatch records kept in memory. */
  maxDispatches?: number
}

export function apply(ctx: Context, config: Config = {}): void {
  const collector = new ObserverCollector(ctx, {
    maxDispatches: config.maxDispatches,
  })

  ctx.provide('cordisDevtools', collector)
  installDevtoolsRpc(ctx, collector)
}

export type {
  CordisDevtoolsService,
  DevtoolsSnapshot,
  DispatchMode,
  DispatchRecord,
  EventSnapshot,
  FiberSnapshot,
  ListenerSnapshot,
} from './shared/types.js'
