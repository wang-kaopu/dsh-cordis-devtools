import type { Context } from '@deepseek-ai/cordis'
import type { CordisDevtoolsService } from '../shared/types.js'
import {
  DEVTOOLS_RPC_CHANNEL,
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

export interface HostConnectionLike {
  rpc: {
    handle(
      channel: string,
      handler: RpcHandlerLike,
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

export function createDevtoolsRpcHandler(service: CordisDevtoolsService): RpcHandlerLike {
  return async (endpoint) => {
    if (endpoint !== DEVTOOLS_RPC_SNAPSHOT_ENDPOINT) {
      return {
        ok: false,
        error: {
          code: 'bad-request',
          message: `unknown Cordis DevTools endpoint: ${endpoint}`,
          details: { issues: [] },
        },
      }
    }

    return { ok: true, value: service.snapshot() }
  }
}

export function registerDevtoolsRpc(
  connection: HostConnectionLike,
  service: CordisDevtoolsService,
): () => Promise<void> {
  return connection.rpc.handle(
    DEVTOOLS_RPC_CHANNEL,
    createDevtoolsRpcHandler(service),
    { authority: 'loopback' },
  )
}

/**
 * Attach the read-only diagnostics channel when DSH Connection exists.
 * `rpc.handle()` binds its registration to the Context reading the Connection
 * service, so running it inside `ctx.inject()` keeps the route lifecycle-owned
 * without making Connection mandatory for pure Cordis usage.
 */
export function installDevtoolsRpc(ctx: Context, service: CordisDevtoolsService): void {
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.get('connection') as HostConnectionLike | undefined
    if (connection?.rpc == null || typeof connection.rpc.handle !== 'function') {
      throw new Error('dsh-cordis-devtools: active connection service does not expose rpc.handle()')
    }
    registerDevtoolsRpc(connection, service)
  })
}
