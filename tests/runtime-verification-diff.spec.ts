import { describe, expect, it } from 'vitest'
import { compareRuntimeCheckpoints } from '../src/host/verification/diff.js'
import type { RuntimeCheckpoint } from '../src/shared/verification.js'

function checkpoint(overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint {
  return {
    schemaVersion: 1,
    capturedAt: 1,
    scope: { eventNames: ['event'], fiberNames: ['Plugin'] },
    digest: 'digest',
    events: [{ name: 'event', listenerCount: 1 }],
    listeners: [{
      id: 1,
      event: 'event',
      order: 0,
      prepend: false,
      global: false,
      owner: { uid: 10, name: 'Plugin', state: 'active' },
    }],
    fibers: [{
      uid: 10,
      name: 'Plugin',
      state: 'active',
      parent: { uid: 1, name: 'root', state: 'active' },
      inject: ['logger'],
      ownedEvents: ['event'],
      effects: [{ label: 'listener', children: [] }],
    }],
    ...overrides,
  }
}

describe('runtime verification semantic diff', () => {
  it('ignores runtime-local listener ids and Fiber uids', () => {
    const baseline = checkpoint()
    const current = checkpoint({
      capturedAt: 2,
      digest: 'different-exact-value',
      listeners: [{
        ...baseline.listeners[0]!,
        id: 99,
        owner: { uid: 88, name: 'Plugin', state: 'active' },
      }],
      fibers: [{
        ...baseline.fibers[0]!,
        uid: 88,
        parent: { uid: 77, name: 'root', state: 'active' },
      }],
    })

    expect(compareRuntimeCheckpoints(baseline, current)).toMatchObject({
      changed: false,
      events: [],
      listenerGroups: [],
      fiberGroups: [],
    })
  })

  it('preserves duplicate multiplicity as 2 -> 1', () => {
    const base = checkpoint()
    const baseline = checkpoint({
      events: [{ name: 'event', listenerCount: 2 }],
      listeners: [
        base.listeners[0]!,
        { ...base.listeners[0]!, id: 2, owner: { uid: 11, name: 'Plugin', state: 'active' } },
      ],
      fibers: [
        base.fibers[0]!,
        { ...base.fibers[0]!, uid: 11 },
      ],
    })
    const current = checkpoint({
      capturedAt: 2,
      digest: 'after',
      listeners: [{ ...base.listeners[0]!, id: 50, owner: { uid: 50, name: 'Plugin', state: 'active' } }],
      fibers: [{ ...base.fibers[0]!, uid: 50 }],
    })

    const result = compareRuntimeCheckpoints(baseline, current)
    expect(result.changed).toBe(true)
    expect(result.events).toEqual([{ name: 'event', beforeListenerCount: 2, afterListenerCount: 1, delta: -1 }])
    expect(result.listenerGroups).toEqual([{ descriptor: {
      event: 'event', ownerName: 'Plugin', order: 0, prepend: false, global: false,
    }, beforeCount: 2, afterCount: 1, delta: -1 }])
    expect(result.fiberGroups).toHaveLength(1)
    expect(result.fiberGroups[0]).toMatchObject({ beforeCount: 2, afterCount: 1, delta: -1 })
  })

  it('canonicalizes unordered Fiber metadata', () => {
    const baseline = checkpoint({
      fibers: [{
        ...checkpoint().fibers[0]!,
        inject: ['zeta', 'alpha'],
        ownedEvents: ['z', 'a'],
        effects: [{ label: 'z', children: [] }, { label: 'a', children: [] }],
      }],
    })
    const current = checkpoint({
      capturedAt: 2,
      digest: 'after',
      fibers: [{
        ...baseline.fibers[0]!,
        uid: 20,
        inject: ['alpha', 'zeta'],
        ownedEvents: ['a', 'z'],
        effects: [{ label: 'a', children: [] }, { label: 'z', children: [] }],
      }],
    })

    expect(compareRuntimeCheckpoints(baseline, current).fiberGroups).toEqual([])
  })

  it('rejects comparisons across different scopes', () => {
    expect(() => compareRuntimeCheckpoints(
      checkpoint(),
      checkpoint({ scope: { eventNames: ['other'] } }),
    )).toThrow('Runtime checkpoint scope mismatch')
  })
})
