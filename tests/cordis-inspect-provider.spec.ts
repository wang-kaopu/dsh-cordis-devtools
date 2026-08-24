import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  CORDIS_RUNTIME_INSPECT_PROVIDER_ID,
  createCordisRuntimeInspectProvider,
  installCordisRuntimeInspect,
} from '../src/host/cordis-inspect.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

function diagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = {
    generatedAt: 10,
    events: [{ name: 'demo/event', listenerCount: 1, listenerIds: [1] }],
    listeners: [{
      id: 1,
      event: 'demo/event',
      order: 0,
      prepend: false,
      global: false,
      owner: { uid: 7, name: 'demo', state: 'active' },
    }],
    fibers: [{
      uid: 7,
      name: 'demo',
      state: 'active',
      parent: null,
      inject: [],
      effects: [],
    }],
    dispatches: [{
      id: 1,
      timestamp: 5,
      mode: 'emit',
      event: 'demo/event',
      argCount: 0,
      registeredListeners: 1,
      thisFiber: { uid: 7, name: 'demo', state: 'active' },
    }],
  }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 11,
    instrumentation: 'disabled',
    traces: [],
  }
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

describe('CordisRuntime inspect provider', () => {
  it('declares the five read-only methods and delegates to RuntimeDiagnosticsQuery', async () => {
    const provider = createCordisRuntimeInspectProvider(diagnostics())

    expect(provider.manifest.id).toBe(CORDIS_RUNTIME_INSPECT_PROVIDER_ID)
    expect(provider.manifest.methods.map(method => method.name)).toEqual([
      'runtimeSummary',
      'inspectEvent',
      'inspectFiber',
      'searchDispatches',
      'profilerTraces',
    ])

    await expect(provider.query('runtimeSummary', {})).resolves.toMatchObject({ liveFibers: 1, listeners: 1 })
    await expect(provider.query('inspectEvent', { name: 'demo/event' })).resolves.toMatchObject({
      found: true,
      listenerCount: 1,
      listeners: [{ ownerLive: true }],
    })
    await expect(provider.query('inspectFiber', { uid: 7 })).resolves.toMatchObject({
      matches: [{ uid: 7, ownedEvents: ['demo/event'] }],
    })
    await expect(provider.query('searchDispatches', { event: 'demo/event' })).resolves.toMatchObject({
      records: [{ id: 1 }],
      window: { bounded: true },
    })
    await expect(provider.query('profilerTraces', {})).resolves.toMatchObject({
      instrumentation: 'disabled',
      traces: [],
    })
  })

  it('keeps registration optional and lifecycle-owned behind the cordisInspect seam', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const effect = vi.fn((factory: () => () => void) => factory())
    const child = {
      get: vi.fn(() => ({ register })),
      effect,
    }
    const inject = vi.fn((_services: string[], callback: (ctx: typeof child) => void) => callback(child))
    const ctx = { inject } as unknown as Context

    installCordisRuntimeInspect(ctx, diagnostics())

    expect(inject).toHaveBeenCalledWith(['cordisInspect'], expect.any(Function))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0].manifest.id).toBe('CordisRuntime')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown methods and malformed exact-event input', async () => {
    const provider = createCordisRuntimeInspectProvider(diagnostics())
    await expect(provider.query('missing', {})).rejects.toThrow('unknown CordisRuntime inspect method')
    await expect(provider.query('inspectEvent', {})).rejects.toThrow('name must be a non-empty string')
  })
})
