import { describe, expect, it } from 'vitest'
import { WaterfallTraceStore } from '../src/host/trace-store.js'
import type { WaterfallDispatchTrace } from '../src/shared/trace.js'

function trace(id: string, event = id): WaterfallDispatchTrace {
  return {
    version: 1,
    id,
    mode: 'waterfall',
    event,
    startedAt: 1,
    returnedAt: 2,
    settledAt: 2,
    outcome: 'returned',
    listeners: [],
  }
}

describe('WaterfallTraceStore', () => {
  it('evicts by first insertion order', () => {
    const store = new WaterfallTraceStore({ maxTraces: 2 })
    store.write(trace('a'))
    store.write(trace('b'))
    store.write(trace('c'))

    expect(store.size).toBe(2)
    expect(store.snapshot().map(row => row.id)).toEqual(['b', 'c'])
  })

  it('updates an existing trace without refreshing its retention age', () => {
    const store = new WaterfallTraceStore({ maxTraces: 2 })
    store.write(trace('a'))
    store.write(trace('b'))
    store.write({ ...trace('a'), event: 'a-revised' })

    expect(store.snapshot().map(row => [row.id, row.event])).toEqual([
      ['a', 'a-revised'],
      ['b', 'b'],
    ])

    store.write(trace('c'))
    expect(store.snapshot().map(row => row.id)).toEqual(['b', 'c'])
  })

  it('copies writes and reads so revisions require an explicit write', () => {
    const store = new WaterfallTraceStore()
    const source = trace('copy')
    source.listeners.push({
      id: 'span-1',
      listenerId: 'listener-1',
      owner: { uid: 1, name: 'owner', state: 'active' },
      order: 0,
      enteredAt: 1,
      returnedAt: 2,
      settledAt: 2,
      outcome: 'returned',
      nextCalls: [],
    })
    store.write(source)

    source.event = 'mutated-source'
    source.listeners[0].owner!.name = 'mutated-owner'
    expect(store.snapshot()[0].event).toBe('copy')
    expect(store.snapshot()[0].listeners[0].owner?.name).toBe('owner')

    const read = store.snapshot()[0]
    read.event = 'mutated-read'
    read.listeners[0].nextCalls.push({
      id: 0,
      calledAt: 3,
      returnedAt: 4,
      settledAt: 4,
      outcome: 'returned',
    })
    expect(store.snapshot()[0].event).toBe('copy')
    expect(store.snapshot()[0].listeners[0].nextCalls).toHaveLength(0)
  })

  it('rejects invalid capacities', () => {
    expect(() => new WaterfallTraceStore({ maxTraces: 0 })).toThrow(RangeError)
    expect(() => new WaterfallTraceStore({ maxTraces: 1.5 })).toThrow(RangeError)
  })
})
