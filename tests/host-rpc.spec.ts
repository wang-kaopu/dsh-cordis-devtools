import { describe, expect, it, vi } from 'vitest'
import {
  createDevtoolsRpcHandler,
  registerDevtoolsRpc,
  type DevtoolsRpcService,
  type HostConnectionLike,
} from '../src/host/rpc.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
  DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT,
  DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT,
  DEVTOOLS_RPC_SNAPSHOT_ENDPOINT,
} from '../src/shared/rpc.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

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
    effects: [],
  }],
  dispatches: [],
}

const disabledProfiler: WaterfallProfilerSnapshot = {
  generatedAt: 2,
  instrumentation: 'disabled',
  traces: [],
}
const enabledProfiler: WaterfallProfilerSnapshot = {
  generatedAt: 3,
  instrumentation: 'enabled',
  traces: [],
}

function createService(): DevtoolsRpcService {
  let profiler = disabledProfiler
  return {
    snapshot: () => snapshot,
    clearDispatches: () => {},
    subscribe: () => () => {},
    profilerSnapshot: () => profiler,
    setInstrumentationEnabled(enabled) {
      profiler = enabled ? enabledProfiler : disabledProfiler
      return profiler
    },
  }
}

describe('Cordis DevTools RPC', () => {
  it('serves observer and profiler snapshots and controls instrumentation', async () => {
    const handler = createDevtoolsRpcHandler(createService())
    const signal = new AbortController().signal

    await expect(handler(DEVTOOLS_RPC_SNAPSHOT_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: snapshot,
    })
    await expect(handler(DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: disabledProfiler,
    })
    await expect(handler(DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: enabledProfiler,
    })
    await expect(handler(DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: enabledProfiler,
    })
    await expect(handler(DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT, {}, signal)).resolves.toEqual({
      ok: true,
      value: disabledProfiler,
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

    const returned = registerDevtoolsRpc(connection, createService())

    expect(returned).toBe(dispose)
    expect(capturedChannel).toBe(DEVTOOLS_RPC_CHANNEL)
    expect(capturedOptions).toEqual({ authority: 'loopback' })
  })
})
