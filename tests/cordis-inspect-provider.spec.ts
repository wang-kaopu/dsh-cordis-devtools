import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  CORDIS_RUNTIME_INSPECT_PROVIDER_ID,
  createCordisRuntimeInspectProvider,
  installCordisRuntimeInspect,
  type CordisRuntimeInspectProviderLike,
} from '../src/host/cordis-inspect.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { RuntimeCheckpoint } from '../src/shared/verification.js'

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
    traces: [{
      version: 1,
      id: 'trace-demo',
      mode: 'waterfall',
      event: 'demo/event',
      experimentId: 'lease-demo',
      startedAt: 1,
      returnedAt: 2,
      settledAt: 2,
      outcome: 'returned',
      listeners: [],
    }],
  }
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
    waterfallExperimentStatus: () => ({
      generatedAt: 12,
      instrumentation: 'disabled',
      owner: { kind: 'none' },
    }),
  })
}

describe('CordisRuntime inspect provider', () => {
  it('declares eight read-only methods and delegates to RuntimeDiagnosticsQuery', async () => {
    const provider = createCordisRuntimeInspectProvider(diagnostics())

    expect(provider.manifest.id).toBe(CORDIS_RUNTIME_INSPECT_PROVIDER_ID)
    expect(provider.manifest.methods.map(method => method.name)).toEqual([
      'runtimeSummary',
      'inspectEvent',
      'inspectFiber',
      'searchDispatches',
      'profilerTraces',
      'waterfallExperimentStatus',
      'captureCheckpoint',
      'compareCurrent',
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
    await expect(provider.query('profilerTraces', { experimentId: 'lease-demo' })).resolves.toMatchObject({
      instrumentation: 'disabled',
      traces: [{ id: 'trace-demo', experimentId: 'lease-demo' }],
      window: { bounded: true, matched: 1 },
    })
    await expect(provider.query('waterfallExperimentStatus', {})).resolves.toMatchObject({
      instrumentation: 'disabled',
      owner: { kind: 'none' },
    })

    const baseline = await provider.query('captureCheckpoint', {
      scope: { eventNames: ['demo/event'], fiberNames: ['demo'] },
    }) as RuntimeCheckpoint
    expect(baseline).toMatchObject({
      schemaVersion: 1,
      scope: { eventNames: ['demo/event'], fiberNames: ['demo'] },
      events: [{ name: 'demo/event', listenerCount: 1 }],
      fibers: [{ uid: 7, name: 'demo' }],
    })
    await expect(provider.query('compareCurrent', { baseline })).resolves.toMatchObject({
      changed: false,
      baselineDigest: baseline.digest,
      events: [],
      listenerGroups: [],
      fiberGroups: [],
    })
  })

  it('keeps registration optional and lifecycle-owned behind the cordisInspect seam', () => {
    const dispose = vi.fn()
    const register = vi.fn((_provider: CordisRuntimeInspectProviderLike) => dispose)
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
    expect(register.mock.calls[0]?.[0].manifest.id).toBe('CordisRuntime')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown methods and malformed verification inputs', async () => {
    const provider = createCordisRuntimeInspectProvider(diagnostics())
    await expect(provider.query('missing', {})).rejects.toThrow('unknown CordisRuntime inspect method')
    await expect(provider.query('inspectEvent', {})).rejects.toThrow('name must be a non-empty string')
    await expect(provider.query('captureCheckpoint', { scope: { eventNames: 'demo/event' } })).rejects.toThrow('eventNames must be an array of strings')
    await expect(provider.query('compareCurrent', {})).rejects.toThrow('baseline must be a RuntimeCheckpoint object')
  })
})
