import { describe, expect, it, vi } from 'vitest'
import {
  createDevtoolsRpcHandler,
  registerDevtoolsRpc,
  type HostConnectionLike,
} from '../src/host/rpc.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_SNAPSHOT_ENDPOINT,
} from '../src/shared/rpc.js'
import type { CordisDevtoolsService, DevtoolsSnapshot } from '../src/shared/types.js'

const snapshot: DevtoolsSnapshot = {
  generatedAt: 1,
  events: [{ name: 'devtools/test', listenerCount: 1, listenerIds: [7] }],
  listeners: [{
    id: 7,
    event: 'devtools/test',
    order: 0,
    prepend: false,
    global: false,
    owner: { uid: 3, name: 'test-plugin', state: 'active' },
  }],
  fibers: [{
    uid: 3,
    name: 'test-plugin',
    state: 'active',
    parent: { uid: 0, name: 'root', state: 'active' },
    inject: [],
  }],
  dispatches: [],
}

const service: CordisDevtoolsService = {
  snapshot: () => snapshot,
  clearDispatches: () => {},
  subscribe: () => () => {},
}

describe('Cordis DevTools RPC', () => {
  it('serves the current snapshot and rejects unknown endpoints', async () => {
    const handler = createDevtoolsRpcHandler(service)
    const signal = new AbortController().signal

    await expect(handler(DEVTOOLS_RPC_SNAPSHOT_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: snapshot,
    })

    await expect(handler('missing', {}, signal)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'bad-request',
      },
    })
  })

  it('registers a loopback-only lifecycle-owned channel through Connection', () => {
    const dispose = vi.fn(async () => {})
    let capturedChannel: string | undefined
    let capturedOptions: { authority: 'loopback' | 'trusted-host' } | undefined
    const connection: HostConnectionLike = {
      rpc: {
        handle(channel, _handler, options) {
          capturedChannel = channel
          capturedOptions = options
          return dispose
        },
      },
    }

    const returned = registerDevtoolsRpc(connection, service)

    expect(returned).toBe(dispose)
    expect(capturedChannel).toBe(DEVTOOLS_RPC_CHANNEL)
    expect(capturedOptions).toEqual({ authority: 'loopback' })
  })
})
