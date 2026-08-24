import type { Context } from '@deepseek-ai/cordis'
import { installCordisRuntimeInspect } from './host/cordis-inspect.js'
import { installDshExperimentTools } from './host/dsh-experiments.js'
import { DEFAULT_MCP_PORT, installEmbeddedMcpServer } from './host/mcp.js'
import { installDevtoolsRpc } from './host/rpc.js'
import { DevtoolsService } from './host/service.js'

export const name = 'dsh-cordis-devtools'
export const provide = 'cordisDevtools'

export interface McpConfig {
  /** Expose read-only runtime diagnostics to external MCP clients. Default false. */
  enabled?: boolean
  /** Loopback TCP port. Default 43127. Use 0 only for programmatic ephemeral-port tests. */
  port?: number
  /** Reject plugin activation if the MCP listener cannot start. Default false. */
  failOnStartupError?: boolean
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
  installCordisRuntimeInspect(ctx, service.diagnostics)
  // Registration is optional through ctx.inject(['tools']); the start body
  // still fails closed unless the real DSH approval seam grants allowed-once.
  installDshExperimentTools(ctx, service)

  if (config.mcp?.enabled === true) {
    await installEmbeddedMcpServer(ctx, service.diagnostics, {
      port: config.mcp.port ?? DEFAULT_MCP_PORT,
      failOnStartupError: config.mcp.failOnStartupError ?? false,
    })
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
export {
  DEFAULT_WATERFALL_EXPERIMENT_TTL_MS,
  MAX_WATERFALL_EXPERIMENT_TTL_MS,
} from './shared/experiments.js'
export type {
  WaterfallControlOwner,
  WaterfallExperimentEndReason,
  WaterfallExperimentId,
  WaterfallExperimentLease,
  WaterfallExperimentLeaseId,
  WaterfallExperimentSource,
  WaterfallExperimentStartInput,
  WaterfallExperimentStartOutcome,
  WaterfallExperimentStartResult,
  WaterfallExperimentStatus,
  WaterfallExperimentStopInput,
  WaterfallExperimentStopOutcome,
  WaterfallExperimentStopResult,
} from './shared/experiments.js'
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
export { RUNTIME_CHECKPOINT_SCHEMA_VERSION } from './shared/verification.js'
export type {
  RuntimeCheckpoint,
  RuntimeCheckpointCaptureInput,
  RuntimeCheckpointCompareInput,
  RuntimeCheckpointComparison,
  RuntimeCheckpointEffect,
  RuntimeCheckpointEvent,
  RuntimeCheckpointFiber,
  RuntimeCheckpointFiberRef,
  RuntimeCheckpointListener,
  RuntimeCheckpointSchemaVersion,
  RuntimeCheckpointScope,
  RuntimeEventComparison,
  RuntimeFiberGroupComparison,
  RuntimeFiberSemanticDescriptor,
  RuntimeListenerGroupComparison,
  RuntimeListenerSemanticDescriptor,
} from './shared/verification.js'
