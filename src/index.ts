import type { Context } from '@deepseek-ai/cordis'
import { installCordisRuntimeInspect } from './host/cordis-inspect.js'
import { installDshExperimentTools } from './host/dsh-experiments.js'
import { createMcpExperimentControl } from './host/mcp-experiment-control.js'
import { DEFAULT_MCP_PORT, installEmbeddedMcpServer } from './host/mcp.js'
import { installDevtoolsRpc } from './host/rpc.js'
import { DevtoolsService } from './host/service.js'
import { readMcpTokenFile } from './bootstrap/token-store.js'

export const name = 'dsh-cordis-devtools'
export const provide = 'cordisDevtools'

export interface McpExperimentConfig {
  /** Expose authenticated start/stop mutation tools. Default false. */
  enabled?: boolean
}

export interface McpConfig {
  /** Expose runtime diagnostics to external MCP clients. Default false. */
  enabled?: boolean
  /** Loopback TCP port. Default 43127. Use 0 only for programmatic ephemeral-port tests. */
  port?: number
  /** Optional bearer token. When configured, every MCP request requires it. */
  token?: string
  /** Absolute normalized owner-only token file. Takes precedence over token. */
  tokenFile?: string
  /** Optional controlled waterfall experiment capability. Omit to preserve the v0.5 seven-tool surface. */
  experiments?: McpExperimentConfig
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
  const mcpToken = config.mcp?.enabled !== true
    ? undefined
    : config.mcp.tokenFile === undefined
      ? config.mcp.token
      : await readMcpTokenFile(config.mcp.tokenFile)

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
    const experiments = config.mcp.experiments === undefined
      ? undefined
      : {
          enabled: config.mcp.experiments.enabled ?? false,
          control: createMcpExperimentControl(service),
        }

    await installEmbeddedMcpServer(ctx, service.diagnostics, {
      port: config.mcp.port ?? DEFAULT_MCP_PORT,
      token: mcpToken,
      failOnStartupError: config.mcp.failOnStartupError ?? false,
      agentDebug: {
        listTargets: () => service.agentDebug.listTargets(),
        attachDebugSession: targetId => service.agentDebug.attachDebugSession(targetId),
        debugSnapshot: input => service.agentDebug.debugSnapshot(input),
        waitForRuntimeChange: input => service.agentDebug.waitForRuntimeChange(input),
        detachDebugSession: debugSessionId => service.agentDebug.detachDebugSession(debugSessionId),
        startAgent: (debugSessionId, source, input) => service.agentDebug.startAgent(debugSessionId, source, input),
        stopAgent: (debugSessionId, input) => service.agentDebug.stopAgent(debugSessionId, input),
      },
      ...(experiments === undefined ? {} : { experiments }),
    })
  }
}

export type {
  AgentDebugCapability,
  AgentDebugCatalog,
  AgentDebugCatalogCursor,
  AgentDebugCatalogInput,
  AgentDebugCatalogWindow,
  AgentDebugCandidateFact,
  AgentDebugDispatchCatalogEntry,
  AgentDebugDispatchObserved,
  AgentDebugEventCatalogEntry,
  AgentDebugExplorationSnapshot,
  AgentDebugFiberCatalogEntry,
  AgentDebugMechanicalCandidate,
  AgentDebugMechanicalCandidateKind,
  AgentDebugObservation,
  AgentDebugObservationBase,
  AgentDebugObservationFilter,
  AgentDebugObservationSequence,
  AgentDebugObservationType,
  AgentDebugObservationWindow,
  AgentDebugProfilerCatalogEntry,
  AgentDebugProfilerStatusChanged,
  AgentDebugProfilerTraceUpdated,
  AgentDebugProtocolInfo,
  AgentDebugRuntimeSummary,
  AgentDebugSessionDetail,
  AgentDebugSessionId,
  AgentDebugSessionStaleReason,
  AgentDebugSessionStatus,
  AgentDebugSnapshotInput,
  AgentDebugSnapshotSection,
  AgentDebugTarget,
  AgentDebugTargetEpoch,
  AgentDebugTargetId,
  AgentDebugTargetMetadata,
  AgentDebugTargetStatus,
  AgentDebugTargetType,
  AgentDebugTargetDisposed,
  AgentDebugTopologyInvalidated,
  AgentDebugWaitForRuntimeChangeInput,
  AgentDebugWaitForRuntimeChangeResult,
  AgentDebugWaitFound,
  AgentDebugWaitGap,
  AgentDebugWaitTimeout,
} from './shared/agent-debug.js'
export {
  AGENT_DEBUG_CAPABILITIES,
  AGENT_DEBUG_MECHANICAL_CANDIDATE_KINDS,
  AGENT_DEBUG_OBSERVATION_TYPES,
  AGENT_DEBUG_PROTOCOL_NAME,
  AGENT_DEBUG_PROTOCOL_VERSION,
  AGENT_DEBUG_SESSION_STATUSES,
  AGENT_DEBUG_SNAPSHOT_SECTIONS,
  AGENT_DEBUG_TARGET_STATUSES,
  AGENT_DEBUG_TARGET_TYPE,
  AGENT_DEBUG_WAIT_OUTCOMES,
  DEFAULT_AGENT_DEBUG_CATALOG_LIMIT,
  DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS,
  MAX_AGENT_DEBUG_CATALOG_LIMIT,
  MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS,
} from './shared/agent-debug.js'
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
