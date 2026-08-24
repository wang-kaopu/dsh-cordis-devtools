import { describe, expect, it } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

function duplicateFiberDiagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = {
    generatedAt: 100,
    events: [{
      name: 'demo/shared-event',
      listenerCount: 2,
      listenerIds: [11, 12],
    }],
    listeners: [
      {
        id: 11,
        event: 'demo/shared-event',
        order: 0,
        prepend: false,
        global: false,
        owner: { uid: 41, name: 'duplicate-plugin', state: 'active' },
      },
      {
        id: 12,
        event: 'demo/shared-event',
        order: 1,
        prepend: false,
        global: false,
        owner: { uid: 42, name: 'duplicate-plugin', state: 'active' },
      },
    ],
    fibers: [
      {
        uid: 41,
        name: 'duplicate-plugin',
        state: 'active',
        parent: { uid: 0, name: 'root', state: 'active' },
        inject: [],
        effects: [{ label: 'demo/shared-event listener', children: [] }],
      },
      {
        uid: 42,
        name: 'duplicate-plugin',
        state: 'active',
        parent: { uid: 0, name: 'root', state: 'active' },
        inject: [],
        effects: [{ label: 'demo/shared-event listener', children: [] }],
      },
    ],
    dispatches: [
      {
        id: 91,
        timestamp: 90,
        mode: 'emit',
        event: 'demo/shared-event',
        argCount: 1,
        registeredListeners: 2,
        thisFiber: { uid: 41, name: 'duplicate-plugin', state: 'active' },
      },
      {
        id: 92,
        timestamp: 95,
        mode: 'emit',
        event: 'demo/shared-event',
        argCount: 1,
        registeredListeners: 2,
        thisFiber: { uid: 42, name: 'duplicate-plugin', state: 'active' },
      },
    ],
  }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 101,
    instrumentation: 'disabled',
    traces: [],
  }

  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

describe('Agent runtime debugging evidence chain', () => {
  it('proves one apparent plugin/event shape can have two authoritative live Fiber owners', () => {
    const diagnostics = duplicateFiberDiagnostics()

    const event = diagnostics.inspectEvent('demo/shared-event')
    expect(event).toMatchObject({
      found: true,
      listenerCount: 2,
    })
    expect(event.listeners.map(listener => listener.owner?.uid)).toEqual([41, 42])
    expect(event.listeners.every(listener => listener.ownerLive)).toBe(true)

    const byName = diagnostics.inspectFiber({ name: 'duplicate-plugin' })
    expect(byName.matches.map(fiber => fiber.uid)).toEqual([41, 42])
    expect(byName.matches.every(fiber => fiber.ownedEvents.includes('demo/shared-event'))).toBe(true)

    for (const uid of [41, 42]) {
      const byUid = diagnostics.inspectFiber({ uid })
      expect(byUid.matches).toHaveLength(1)
      expect(byUid.matches[0]).toMatchObject({
        uid,
        state: 'active',
        ownedEvents: ['demo/shared-event'],
      })
    }
  })

  it('keeps recent dispatch evidence explicitly bounded and newest-first', () => {
    const diagnostics = duplicateFiberDiagnostics()

    const recent = diagnostics.searchDispatches({ event: 'demo/shared-event' })
    expect(recent.records.map(record => record.thisFiber?.uid)).toEqual([42, 41])
    expect(recent.window).toEqual({
      bounded: true,
      retained: 2,
      matched: 2,
      returned: 2,
      truncated: false,
    })

    const limited = diagnostics.searchDispatches({ event: 'demo/shared-event', limit: 1 })
    expect(limited.records.map(record => record.id)).toEqual([92])
    expect(limited.window).toMatchObject({
      bounded: true,
      matched: 2,
      returned: 1,
      truncated: true,
    })
  })
})
