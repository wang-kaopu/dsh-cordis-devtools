import type { Context } from '@deepseek-ai/cordis'
import type { CordisDevtoolsService } from '../shared/types.js'
import type { WaterfallProfilerService } from '../shared/trace.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
  DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT,
  DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT,
  DEVTOOLS_RPC_SNAPSHOT_ENDPOINT,
} from '../shared/rpc.js'

interface RpcErrorLike {
  code: 'bad-request' | 'internal'
  message: string
  details: { issues: unknown[] } | Record<string, never>
}

type RpcResultLike =
  | { ok: true; value: unknown }
  | { ok: false; error: RpcErrorLike }

type RpcHandlerLike = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResultLike>

export type DevtoolsRpcService = CordisDevtoolsService & WaterfallProfilerService

export interface HostConnectionLike {
  rpc: {
    handle(
      channel: string,
      handler: RpcHandlerLike,
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

export function createDevtoolsRpcHandler(service: DevtoolsRpcService): RpcHandlerLike {
  return async (endpoint) => {
    switch (endpoint) {
      case DEVTOOLS_RPC_SNAPSHOT_ENDPOINT:
        return { ok: true, value: service.snapshot() }
      case DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT:
        return { ok: true, value: service.profilerSnapshot() }
      case DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT:
        return { ok: true, value: service.setInstrumentationEnabled(true) }
      case DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT:
        return { ok: true, value: service.setInstrumentationEnabled(false) }
      default:
        return {
          ok: false,
          error: {
            code: 'bad-request',
            message: `unknown Cordis DevTools endpoint: ${endpoint}`,
            details: { issues: [] },
          },
        }
    }
  }
}

export function registerDevtoolsRpc(
  connection: HostConnectionLike,
  service: DevtoolsRpcService,
): () => Promise<void> {
  return connection.rpc.handle(
    DEVTOOLS_RPC_CHANNEL,
    createDevtoolsRpcHandler(service),
    { authority: 'loopback' },
  )
}

/**
 * Attach the diagnostics channel when DSH Connection exists.
 * `rpc.handle()` binds its registration to the Context reading the Connection
 * service, so running it inside `ctx.inject()` keeps the route lifecycle-owned
 * without making Connection mandatory for pure Cordis usage.
 */
export function installDevtoolsRpc(ctx: Context, service: DevtoolsRpcService): void {
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.get('connection') as HostConnectionLike | undefined
    if (connection?.rpc == null || typeof connection.rpc.handle !== 'function') {
      throw new Error('dsh-cordis-devtools: active connection service does not expose rpc.handle()')
    }
    registerDevtoolsRpc(connection, service)
  })
}
