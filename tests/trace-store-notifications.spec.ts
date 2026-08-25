import { describe, expect, it, vi } from 'vitest'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
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

describe('WaterfallTraceStore notifications', () => {
  it('publishes metadata after an insert is cloned and retained', () => {
    const source = new RuntimeNotificationSource()
    const store = new WaterfallTraceStore({ maxTraces: 2, runtimeNotifications: source })
    const observed: unknown[] = []
    source.subscribe(notification => {
      observed.push({ notification, snapshot: store.snapshot() })
    })

    store.write(trace('trace-1', 'tools/call'))

    expect(observed).toEqual([{
      notification: {
        type: 'profiler-trace-updated',
        traceId: 'trace-1',
        event: 'tools/call',
      },
      snapshot: [trace('trace-1', 'tools/call')],
    }])
  })

  it('publishes updates without refreshing retention order', () => {
    const source = new RuntimeNotificationSource()
    const store = new WaterfallTraceStore({ maxTraces: 2, runtimeNotifications: source })
    const listener = vi.fn()
    source.subscribe(listener)
    store.write(trace('a'))
    store.write(trace('b'))
    store.write(trace('a', 'a-revised'))
    store.write(trace('c'))

    expect(listener.mock.calls.map(([notification]) => notification)).toEqual([
      { type: 'profiler-trace-updated', traceId: 'a', event: 'a' },
      { type: 'profiler-trace-updated', traceId: 'b', event: 'b' },
      { type: 'profiler-trace-updated', traceId: 'a', event: 'a-revised' },
      { type: 'profiler-trace-updated', traceId: 'c', event: 'c' },
    ])
    expect(store.snapshot().map(row => row.id)).toEqual(['b', 'c'])
  })

  it('reports the inserted trace after bounded eviction has settled', () => {
    const source = new RuntimeNotificationSource()
    const store = new WaterfallTraceStore({ maxTraces: 1, runtimeNotifications: source })
    const listener = vi.fn()
    source.subscribe(notification => listener(notification, store.snapshot()))

    store.write(trace('old', 'old-event'))
    store.write(trace('new', 'new-event'))

    expect(listener.mock.calls.at(-1)).toEqual([
      { type: 'profiler-trace-updated', traceId: 'new', event: 'new-event' },
      [trace('new', 'new-event')],
    ])
    expect(listener.mock.calls).not.toContainEqual([
      { type: 'profiler-trace-updated', traceId: 'old', event: 'old-event' },
      [trace('new', 'new-event')],
    ])
  })

  it('keeps notification metadata free of trace internals', () => {
    const source = new RuntimeNotificationSource()
    const store = new WaterfallTraceStore({ runtimeNotifications: source })
    const listener = vi.fn()
    source.subscribe(listener)
    const row = trace('safe', 'secret-free-event')
    row.experimentId = 'lease-secret-like'
    row.listeners.push({
      id: 'span-1',
      listenerId: 'listener-1',
      owner: null,
      order: 0,
      enteredAt: 1,
      returnedAt: 2,
      settledAt: 2,
      outcome: 'returned',
      nextCalls: [],
    })

    store.write(row)

    expect(listener).toHaveBeenCalledWith({
      type: 'profiler-trace-updated',
      traceId: 'safe',
      event: 'secret-free-event',
    })
    expect(listener.mock.calls[0]?.[0]).not.toHaveProperty('experimentId')
    expect(listener.mock.calls[0]?.[0]).not.toHaveProperty('listeners')
  })
})
