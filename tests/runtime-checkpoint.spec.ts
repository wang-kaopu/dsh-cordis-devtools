import { describe, expect, it } from 'vitest'
import {
  captureRuntimeCheckpoint,
  computeRuntimeCheckpointDigest,
} from '../src/host/verification/checkpoint.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

const snapshot: DevtoolsSnapshot = {
  generatedAt: 100,
  events: [
    { name: 'alpha', listenerCount: 2, listenerIds: [1, 2] },
    { name: 'beta', listenerCount: 1, listenerIds: [3] },
  ],
  listeners: [
    { id: 1, event: 'alpha', order: 0, prepend: false, global: false, owner: { uid: 10, name: 'Plugin', state: 'active' } },
    { id: 2, event: 'alpha', order: 1, prepend: false, global: false, owner: { uid: 11, name: 'Other', state: 'active' } },
    { id: 3, event: 'beta', order: 0, prepend: true, global: false, owner: { uid: 10, name: 'Plugin', state: 'active' } },
  ],
  fibers: [
    {
      uid: 10,
      name: 'Plugin',
      state: 'active',
      parent: { uid: 1, name: 'root', state: 'active' },
      inject: ['zeta', 'alpha', 'alpha'],
      effects: [
        { label: 'z', children: [] },
        { label: 'a', children: [{ label: 'child', children: [] }] },
      ],
    },
    {
      uid: 11,
      name: 'Other',
      state: 'active',
      parent: { uid: 1, name: 'root', state: 'active' },
      inject: [],
      effects: [],
    },
  ],
  dispatches: [
    { id: 9, timestamp: 90, mode: 'emit', event: 'alpha', argCount: 0, registeredListeners: 2, thisFiber: null },
  ],
}

describe('runtime checkpoint projection', () => {
  it('captures authoritative topology without bounded dispatch history', () => {
    const checkpoint = captureRuntimeCheckpoint(snapshot)

    expect(checkpoint.schemaVersion).toBe(1)
    expect(checkpoint.capturedAt).toBe(100)
    expect(checkpoint.events).toEqual([
      { name: 'alpha', listenerCount: 2 },
      { name: 'beta', listenerCount: 1 },
    ])
    expect(checkpoint.listeners).toHaveLength(3)
    expect(checkpoint.fibers).toHaveLength(2)
    expect(JSON.stringify(checkpoint)).not.toContain('registeredListeners')
    expect(checkpoint.digest).toBe(computeRuntimeCheckpointDigest(checkpoint))
  })

  it('uses union scope semantics and one-hop owner closure', () => {
    const checkpoint = captureRuntimeCheckpoint(snapshot, {
      scope: {
        eventNames: ['alpha'],
        fiberNames: ['Plugin'],
      },
    })

    expect(checkpoint.scope).toEqual({ eventNames: ['alpha'], fiberNames: ['Plugin'] })
    expect(checkpoint.listeners.map(listener => listener.id)).toEqual([1, 2, 3])
    expect(checkpoint.fibers.map(fiber => fiber.uid)).toEqual([11, 10])
    expect(checkpoint.events).toEqual([
      { name: 'alpha', listenerCount: 2 },
      { name: 'beta', listenerCount: 1 },
    ])
  })

  it('keeps an explicit empty selector distinct from omitted selectors', () => {
    const checkpoint = captureRuntimeCheckpoint(snapshot, {
      scope: { eventNames: [] },
    })

    expect(checkpoint.scope).toEqual({ eventNames: [] })
    expect(checkpoint.events).toEqual([])
    expect(checkpoint.listeners).toEqual([])
    expect(checkpoint.fibers).toEqual([])
  })

  it('canonicalizes unordered metadata before hashing', () => {
    const first = captureRuntimeCheckpoint(snapshot)
    const reordered: DevtoolsSnapshot = {
      ...snapshot,
      events: [...snapshot.events].reverse(),
      listeners: [...snapshot.listeners].reverse(),
      fibers: [...snapshot.fibers].reverse().map(fiber => ({
        ...fiber,
        inject: [...fiber.inject].reverse(),
        effects: [...fiber.effects].reverse(),
      })),
    }
    const second = captureRuntimeCheckpoint(reordered)

    expect(second).toEqual(first)
  })
})
