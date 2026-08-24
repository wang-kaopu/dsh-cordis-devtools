import { describe, expect, it } from 'vitest'
import type {
  WaterfallDispatchTrace,
  WaterfallTraceReader,
  WaterfallTraceSink,
} from '../src/shared/trace.js'

describe('waterfall trace contract', () => {
  it('stays serializable and metadata-only', () => {
    const trace: WaterfallDispatchTrace = {
      version: 1,
      id: 'trace-1',
      mode: 'waterfall',
      event: 'devtools/waterfall',
      startedAt: 10,
      returnedAt: 20,
      settledAt: 30,
      outcome: 'fulfilled',
      listeners: [{
        id: 'span-1',
        listenerId: 'listener-1',
        owner: { uid: 4, name: 'plugin-a', state: 'active' },
        order: 0,
        enteredAt: 11,
        returnedAt: 18,
        settledAt: 29,
        outcome: 'fulfilled',
        nextCalls: [
          { id: 0, calledAt: 12, returnedAt: 15, settledAt: 17, outcome: 'returned' },
          { id: 1, calledAt: 21, returnedAt: 22, settledAt: 28, outcome: 'fulfilled' },
        ],
      }],
    }

    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
    expect(trace.listeners[0].nextCalls).toHaveLength(2)
    expect(trace).not.toHaveProperty('selfTime')
    expect(trace).not.toHaveProperty('shortCircuit')
    expect(trace.listeners[0]).not.toHaveProperty('selfTime')
    expect(trace.listeners[0]).not.toHaveProperty('arguments')
    expect(trace.listeners[0]).not.toHaveProperty('returnValue')
    expect(trace.listeners[0]).not.toHaveProperty('error')
  })

  it('supports an upsert sink and snapshot reader boundary', () => {
    const rows = new Map<string, WaterfallDispatchTrace>()
    const sink: WaterfallTraceSink = { write: trace => { rows.set(trace.id, trace) } }
    const reader: WaterfallTraceReader = { snapshot: () => [...rows.values()] }
    const trace: WaterfallDispatchTrace = {
      version: 1,
      id: 'late-next',
      mode: 'waterfall',
      event: 'devtools/late',
      startedAt: 1,
      returnedAt: 2,
      settledAt: 2,
      outcome: 'returned',
      listeners: [],
    }

    sink.write(trace)
    sink.write({ ...trace, listeners: [{
      id: 'span-1',
      listenerId: 'listener-1',
      owner: null,
      order: 0,
      enteredAt: 1,
      returnedAt: 2,
      settledAt: 2,
      outcome: 'returned',
      nextCalls: [{ id: 0, calledAt: 5, returnedAt: 6, settledAt: 6, outcome: 'returned' }],
    }] })

    expect(reader.snapshot()).toHaveLength(1)
    expect(reader.snapshot()[0].listeners[0].nextCalls[0].calledAt).toBe(5)
  })
})
