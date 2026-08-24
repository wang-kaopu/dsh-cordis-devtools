import type { Context } from '@deepseek-ai/cordis'
import { installDevtoolsRpc } from './host/rpc.js'
import { DevtoolsService } from './host/service.js'

export const name = 'dsh-cordis-devtools'
export const provide = 'cordisDevtools'

export interface Config {
  /** Maximum number of recent dispatch records kept in memory. */
  maxDispatches?: number
  /** Maximum number of bounded waterfall profiler traces kept in memory. */
  maxTraces?: number
}

export function apply(ctx: Context, config: Config = {}): void {
  const service = new DevtoolsService(ctx, {
    maxDispatches: config.maxDispatches,
    maxTraces: config.maxTraces,
  })

  ctx.effect(
    () => () => { service.dispose() },
    'dsh-cordis-devtools: dispose waterfall instrumentation',
  )
  ctx.provide('cordisDevtools', service)
  installDevtoolsRpc(ctx, service)
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
export type {
  WaterfallDispatchTrace,
  WaterfallInstrumentationState,
  WaterfallListenerSpan,
  WaterfallNextCall,
  WaterfallProfilerSnapshot,
  WaterfallTraceOutcome,
} from './shared/trace.js'
