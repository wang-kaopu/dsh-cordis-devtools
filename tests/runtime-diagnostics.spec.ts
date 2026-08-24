import { describe, expect, it } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const observer: DevtoolsSnapshot = {
  generatedAt: 100,
  events: [
    { name: 'alpha', listenerCount: 2, listenerIds: [1, 2] },
    { name: 'beta', listenerCount: 1, listenerIds: [3] },
  ],
  listeners: [
    { id: 1, event: 'alpha', order: 20, prepend: false, global: false, owner: { uid: 1, name: 'Plugin', state: 'active' } },
    { id: 2, event: 'alpha', order: 10, prepend: true, global: false, owner: { uid: 99, name: 'OldPlugin', state: 'disposed' } },
    { id: 3, event: 'beta', order: 0, prepend: false, global: true, owner: { uid: 2, name: 'Plugin', state: 'active' } },
  ],
  fibers: [
    {
      uid: 1,
      name: 'Plugin',
      state: 'active',
      parent: { uid: 0, name: 'root', state: 'active' },
      inject: ['logger'],
      effects: [{ label: 'ctx.on(alpha)', children: [] }],
    },
    {
      uid: 2,
      name: 'Plugin',
      state: 'active',
      parent: { uid: 0, name: 'root', state: 'active' },
      inject: [],
      effects: [],
    },
  ],
  dispatches: [
    { id: 1, timestamp: 10, mode: 'emit', event: 'alpha', argCount: 1, registeredListeners: 2, thisFiber: { uid: 1, name: 'Plugin', state: 'active' } },
    { id: 2, timestamp: 20, mode: 'emit', event: 'beta', argCount: 0, registeredListeners: 1, thisFiber: { uid: 2, name: 'Plugin', state: 'active' } },
    { id: 3, timestamp: 30, mode: 'waterfall', event: 'alpha', argCount: 2, registeredListeners: 2, thisFiber: { uid: 1, name: 'Plugin', state: 'active' } },
  ],
}

const profiler: WaterfallProfilerSnapshot = {
  generatedAt: 110,
  instrumentation: 'disabled',
  traces: [
    {
      version: 1,
      id: 'trace-1',
      mode: 'waterfall',
      event: 'alpha',
      experimentId: 'lease-a',
      startedAt: 10,
      returnedAt: 11,
      settledAt: 12,
      outcome: 'fulfilled',
      listeners: [],
    },
    {
      version: 1,
      id: 'trace-2',
      mode: 'waterfall',
      event: 'beta',
      startedAt: 20,
      returnedAt: 21,
      settledAt: 22,
      outcome: 'fulfilled',
      listeners: [],
    },
    {
      version: 1,
      id: 'trace-3',
      mode: 'waterfall',
      event: 'alpha',
      experimentId: 'lease-a',
      startedAt: 30,
      returnedAt: null,
      settledAt: null,
      outcome: 'running',
      listeners: [],
    },
  ],
}

function createQuery(): RuntimeDiagnosticsQuery {
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

describe('RuntimeDiagnosticsQuery', () => {
  it('returns a compact summary with explicit bounded windows', () => {
    expect(createQuery().runtimeSummary()).toEqual({
      generatedAt: 110,
      events: 2,
      listeners: 3,
      liveFibers: 2,
      dispatchWindow: { bounded: true, retained: 3 },
      profiler: {
        instrumentation: 'disabled',
        traces: { bounded: true, retained: 3 },
      },
    })
  })

  it('inspects one live event and distinguishes historical owner references', () => {
    const result = createQuery().inspectEvent('alpha')

    expect(result.found).toBe(true)
    expect(result.listeners.map(listener => [listener.id, listener.ownerLive])).toEqual([
      [2, false],
      [1, true],
    ])
    expect(createQuery().inspectEvent('missing')).toMatchObject({
      found: false,
      listenerCount: 0,
      listeners: [],
    })
  })

  it('returns only authoritative live Fiber matches with derived ownership facts', () => {
    const result = createQuery().inspectFiber({ name: 'Plugin' })

    expect(result.matches.map(fiber => fiber.uid)).toEqual([1, 2])
    expect(result.matches[0]).toMatchObject({
      uid: 1,
      ownedListenerIds: [1],
      ownedEvents: ['alpha'],
      recentDispatchContextHits: 2,
    })
    expect(result.matches[1]).toMatchObject({
      uid: 2,
      ownedListenerIds: [3],
      ownedEvents: ['beta'],
      recentDispatchContextHits: 1,
    })
    expect(createQuery().inspectFiber({ uid: 99 }).matches).toEqual([])
  })

  it('searches retained dispatches newest-first and reports caller truncation separately from bounded history', () => {
    const result = createQuery().searchDispatches({ event: 'alpha', limit: 1 })

    expect(result.records.map(record => record.id)).toEqual([3])
    expect(result.window).toEqual({
      bounded: true,
      retained: 3,
      matched: 2,
      returned: 1,
      truncated: true,
    })
  })

  it('reads existing profiler traces without enabling instrumentation', () => {
    const query = createQuery()
    const result = query.profilerTraces({ event: 'alpha', limit: 1 })

    expect(result.instrumentation).toBe('disabled')
    expect(result.traces.map(trace => trace.id)).toEqual(['trace-3'])
    expect(result.window).toEqual({
      bounded: true,
      retained: 3,
      matched: 2,
      returned: 1,
      truncated: true,
    })
    expect(query.runtimeSummary().profiler.instrumentation).toBe('disabled')
  })

  it('filters retained profiler traces by exact experiment id while preserving bounded semantics', () => {
    const result = createQuery().profilerTraces({ experimentId: 'lease-a' })

    expect(result.traces.map(trace => trace.id)).toEqual(['trace-3', 'trace-1'])
    expect(result.traces.every(trace => trace.experimentId === 'lease-a')).toBe(true)
    expect(result.window).toEqual({
      bounded: true,
      retained: 3,
      matched: 2,
      returned: 2,
      truncated: false,
    })
    expect(createQuery().profilerTraces({ experimentId: 'missing' }).window.matched).toBe(0)
  })

  it('rejects ambiguous selectors and unbounded caller limits', () => {
    const query = createQuery()
    expect(() => query.inspectFiber({} as never)).toThrow('exactly one')
    expect(() => query.searchDispatches({ limit: 101 })).toThrow('between 1 and 100')
    expect(() => query.profilerTraces({ limit: 0 })).toThrow('between 1 and 100')
  })
})