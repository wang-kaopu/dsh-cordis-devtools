import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_MCP_PORT, startEmbeddedMcpServer } from './host/mcp.js'
import { installDevtoolsRpc } from './host/rpc.js'
import { DevtoolsService } from './host/service.js'

export const name = 'dsh-cordis-devtools'
export const provide = 'cordisDevtools'

export interface McpConfig {
  /** Expose read-only runtime diagnostics to external MCP clients. Default false. */
  enabled?: boolean
  /** Loopback TCP port. Default 43127. Use 0 only for programmatic ephemeral-port tests. */
  port?: number
}

export interface Config {
  /** Maximum number of recent dispatch records kept in memory. */
  maxDispatches?: number
  /** Maximum number of bounded waterfall profiler traces kept in memory. */
  maxTraces?: number
  /** Optional external-agent MCP endpoint; always bound to 127.0.0.1. */
  mcp?: McpConfig
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
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

  if (config.mcp?.enabled === true) {
    await ctx.effect(async () => {
      const handle = await startEmbeddedMcpServer(service.diagnostics, {
        port: config.mcp?.port ?? DEFAULT_MCP_PORT,
      })
      console.info(`[dsh-cordis-devtools] MCP diagnostics: ${handle.url}`)
      return () => handle.close()
    }, 'dsh-cordis-devtools: embedded MCP diagnostics')
  }
}

export type {
  BoundedEvidenceWindow,
  LimitedEvidenceWindow,
  RuntimeDiagnosticsSummary,
  RuntimeDispatchSearchInput,
  RuntimeDispatchSearchResult,
  RuntimeEventInspection,
  RuntimeEventListener,
  RuntimeFiberDetail,
  RuntimeFiberInspection,
  RuntimeFiberSelector,
  RuntimeProfilerTraceSearchInput,
  RuntimeProfilerTraceSearchResult,
} from './shared/diagnostics.js'
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
