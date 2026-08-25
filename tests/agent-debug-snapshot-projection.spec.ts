import { describe, expect, it } from 'vitest'
import {
  pageAgentDebugCatalog,
  projectAgentDebugDispatchCatalog,
  projectAgentDebugEventCatalog,
  projectAgentDebugFiberCatalog,
  projectAgentDebugMechanicalCandidates,
  projectAgentDebugRuntimeSummary,
} from '../src/host/agent-debug/snapshot-projection.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

function observerFixture(): DevtoolsSnapshot {
  return {
    generatedAt: 10,
    events: [
      { name: 'z-event', listenerCount: 1, listenerIds: [3] },
      { name: 'a-event', listenerCount: 3, listenerIds: [1, 2, 4] },
    ],
    listeners: [
      { id: 2, event: 'a-event', order: 2, prepend: false, global: false, owner: { uid: 20, name: 'same', state: 'active' } },
      { id: 1, event: 'a-event', order: 1, prepend: false, global: false, owner: { uid: 21, name: 'same', state: 'active' } },
      { id: 4, event: 'a-event', order: 3, prepend: false, global: false, owner: { uid: 99, name: 'gone', state: 'active' } },
      { id: 3, event: 'z-event', order: 1, prepend: true, global: true, owner: { uid: 20, name: 'same', state: 'active' } },
    ],
    fibers: [
      { uid: 21, name: 'same', state: 'active', parent: { uid: 0, name: 'root', state: 'active' }, inject: [], effects: [] },
      { uid: 20, name: 'same', state: 'active', parent: { uid: 0, name: 'root', state: 'active' }, inject: [], effects: [] },
      { uid: 1, name: 'other', state: 'active', parent: null, inject: [], effects: [] },
    ],
    dispatches: [
      { id: 1, timestamp: 5, event: 'old', mode: 'emit', argCount: 0, registeredListeners: 0, thisFiber: null },
      { id: 3, timestamp: 8, event: 'newer', mode: 'emit', argCount: 0, registeredListeners: 0, thisFiber: null },
      { id: 2, timestamp: 8, event: 'new', mode: 'emit', argCount: 0, registeredListeners: 0, thisFiber: null },
    ],
  }
}

function profilerFixture(): WaterfallProfilerSnapshot {
  return {
    generatedAt: 20,
    instrumentation: 'conflict',
    traces: [{
      version: 1,
      id: 'trace-1',
      mode: 'waterfall',
      event: 'a-event',
      startedAt: 1,
      returnedAt: 10,
      settledAt: 11,
      outcome: 'returned',
      listeners: [{
        id: 'span-1',
        listenerId: 'listener-1',
        owner: null,
        order: 0,
        enteredAt: 2,
        returnedAt: 5,
        settledAt: 5,
        outcome: 'returned',
        nextCalls: [
          { id: 1, calledAt: 3, returnedAt: 4, settledAt: 4, outcome: 'returned' },
          { id: 2, calledAt: 12, returnedAt: 13, settledAt: 13, outcome: 'returned' },
        ],
      }],
    }],
  }
}

describe('Agent Debug snapshot projection', () => {
  it('projects summary and stable catalogs', () => {
    const observer = observerFixture()
    const profiler = profilerFixture()
    expect(projectAgentDebugRuntimeSummary(observer, profiler)).toEqual({
      generatedAt: 20,
      events: 2,
      listeners: 4,
      liveFibers: 3,
      dispatchesRetained: 3,
      tracesRetained: 1,
    })
    expect(projectAgentDebugEventCatalog(observer).map(item => item.name)).toEqual(['a-event', 'z-event'])
    expect(projectAgentDebugFiberCatalog(observer).map(item => [item.name, item.uid])).toEqual([['other', 1], ['same', 20], ['same', 21]])
    expect(projectAgentDebugDispatchCatalog(observer).map(item => item.dispatchId)).toEqual([3, 2, 1])
  })

  it('enforces bounded catalog pages and preserves opaque cursor without inventing next cursor', () => {
    const page = pageAgentDebugCatalog(['a', 'b', 'c'], { limit: 2, offset: 1, cursor: 'opaque' })
    expect(page).toEqual({
      items: ['b', 'c'],
      window: { bounded: true, limit: 2, returned: 2, total: 3, truncated: false, cursor: 'opaque', nextCursor: null },
    })
    expect(() => pageAgentDebugCatalog(['a'], { limit: 0 })).toThrow(RangeError)
    expect(() => pageAgentDebugCatalog(['a'], { limit: 101 })).toThrow(RangeError)
    expect(() => pageAgentDebugCatalog(['a'], { offset: -1 })).toThrow(RangeError)
    expect(() => pageAgentDebugCatalog(['a'], { offset: 2 })).toThrow(RangeError)
  })

  it('groups semantic duplicates independent of listener ids/order and emits only factual candidate fields', () => {
    const candidates = projectAgentDebugMechanicalCandidates(observerFixture(), profilerFixture())
    const duplicateFibers = candidates.find(candidate => candidate.kind === 'duplicate-live-fibers')
    const duplicateListeners = candidates.find(candidate => candidate.kind === 'equivalent-listener-registrations')
    expect(duplicateFibers).toMatchObject({ key: 'same', count: 2 })
    expect(duplicateListeners).toBeDefined()
    expect(duplicateListeners?.count).toBe(2)
    expect(candidates.find(candidate => candidate.kind === 'orphaned-listener-owner')).toMatchObject({ count: 1 })
    expect(candidates.find(candidate => candidate.kind === 'trace-next-anomaly')).toMatchObject({ count: 2 })
    expect(candidates.find(candidate => candidate.kind === 'instrumentation-conflict')).toMatchObject({ key: 'conflict', count: 1 })
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty('rootCause')
      expect(candidate).not.toHaveProperty('confidence')
      expect(candidate).not.toHaveProperty('remediation')
      expect(candidate.evidence.every(fact => Object.keys(fact).every(key => key === 'field' || key === 'value'))).toBe(true)
    }
  })

  it('reports unsupported instrumentation as the same mechanical conflict kind', () => {
    const profiler = profilerFixture()
    profiler.instrumentation = 'unsupported'
    expect(projectAgentDebugMechanicalCandidates(observerFixture(), profiler)).toContainEqual(expect.objectContaining({ kind: 'instrumentation-conflict', key: 'unsupported' }))
  })
})
