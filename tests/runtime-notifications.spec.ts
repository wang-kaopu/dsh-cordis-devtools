import { describe, expect, it, vi } from 'vitest'
import type {
  RuntimeDispatchNotification,
  RuntimeProfilerStatusChangedNotification,
  RuntimeProfilerTraceUpdatedNotification,
  RuntimeTopologyInvalidatedNotification,
} from '../src/host/runtime-notifications.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'

const dispatch: RuntimeDispatchNotification = {
  type: 'dispatch-observed',
  dispatchId: 7,
  event: 'tools/call',
  mode: 'emit',
  argCount: 1,
  registeredListeners: 2,
}

const topology: RuntimeTopologyInvalidatedNotification = {
  type: 'topology-invalidated',
  reason: 'event-listeners',
}

const trace: RuntimeProfilerTraceUpdatedNotification = {
  type: 'profiler-trace-updated',
  traceId: 'wf-1',
  event: 'tools/call',
}

const profiler: RuntimeProfilerStatusChangedNotification = {
  type: 'profiler-status-changed',
  instrumentation: 'enabled',
}

describe('RuntimeNotificationSource', () => {
  it('fans out all four metadata-only notification kinds in publication order', () => {
    const source = new RuntimeNotificationSource()
    const first = vi.fn()
    const second = vi.fn()
    source.subscribe(first)
    source.subscribe(second)

    source.publish(dispatch)
    source.publish(topology)
    source.publish(trace)
    source.publish(profiler)

    expect(first.mock.calls.map(([notification]) => notification.type)).toEqual([
      'dispatch-observed',
      'topology-invalidated',
      'profiler-trace-updated',
      'profiler-status-changed',
    ])
    expect(second).toHaveBeenCalledTimes(4)
    expect(first.mock.calls[0]?.[0]).toEqual(dispatch)
    expect(first.mock.calls[1]?.[0]).toEqual(topology)
    expect(first.mock.calls[2]?.[0]).toEqual(trace)
    expect(first.mock.calls[3]?.[0]).toEqual(profiler)
  })

  it('returns an idempotent lifecycle disposer and isolates subscription mutation', () => {
    const source = new RuntimeNotificationSource()
    const received: string[] = []
    let disposeFirst = () => {}
    disposeFirst = source.subscribe(notification => {
      received.push(`first:${notification.type}`)
      disposeFirst()
    })
    source.subscribe(notification => received.push(`second:${notification.type}`))

    source.publish(dispatch)
    source.publish(topology)
    disposeFirst()

    expect(received).toEqual([
      'first:dispatch-observed',
      'second:dispatch-observed',
      'second:topology-invalidated',
    ])
  })

  it('disposes all subscriptions and ignores later activity', () => {
    const source = new RuntimeNotificationSource()
    const listener = vi.fn()
    const disposer = source.subscribe(listener)

    source.dispose()
    disposer()
    source.publish(dispatch)

    expect(source.isDisposed).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    expect(() => source.subscribe(listener)).not.toThrow()
  })
})
