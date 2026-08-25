import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ObserverCollector } from '../src/host/collector.js'
import {
  RuntimeNotificationSource,
  type RuntimeNotification,
} from '../src/host/runtime-notifications.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/collector-notification'(): void
  }
}

describe('ObserverCollector runtime notifications', () => {
  it('publishes dispatch metadata after retaining the dispatch fact', () => {
    const ctx = new Context()
    const source = new RuntimeNotificationSource()
    const notifications: RuntimeNotification[] = []
    const collector = new ObserverCollector(ctx, { runtimeNotifications: source })
    source.subscribe(notification => notifications.push(notification))

    ctx.emit('devtools/collector-notification')

    const notification = notifications.find(candidate => candidate.type === 'dispatch-observed')
    expect(notification).toMatchObject({
      type: 'dispatch-observed',
      event: 'devtools/collector-notification',
      mode: 'emit',
      argCount: 0,
      registeredListeners: 0,
    })
    expect(collector.snapshot().dispatches).toContainEqual(expect.objectContaining({
      id: notification?.type === 'dispatch-observed' ? notification.dispatchId : -1,
      event: 'devtools/collector-notification',
    }))
  })

  it('publishes listener invalidation after the live registry has settled', async () => {
    const ctx = new Context()
    const source = new RuntimeNotificationSource()
    const notifications: RuntimeNotification[] = []
    const collector = new ObserverCollector(ctx, { runtimeNotifications: source })
    source.subscribe(notification => notifications.push(notification))

    ctx.on('devtools/collector-notification', () => {})
    expect(notifications.filter(notification => notification.type === 'topology-invalidated')).toHaveLength(0)

    await Promise.resolve()

    const topology = notifications.find(
      notification => notification.type === 'topology-invalidated' && notification.reason === 'event-listeners',
    )
    expect(topology).toEqual({ type: 'topology-invalidated', reason: 'event-listeners' })
    expect(collector.snapshot().events).toContainEqual(expect.objectContaining({
      name: 'devtools/collector-notification',
      listenerCount: 1,
    }))
  })

  it('publishes fiber invalidation after plugin lifecycle facts have settled', async () => {
    const ctx = new Context()
    const source = new RuntimeNotificationSource()
    const notifications: RuntimeNotification[] = []
    new ObserverCollector(ctx, { runtimeNotifications: source })
    source.subscribe(notification => notifications.push(notification))

    await ctx.plugin({ name: 'collector-notification-plugin', apply() {} })
    await Promise.resolve()

    expect(notifications).toContainEqual({ type: 'topology-invalidated', reason: 'fibers' })
  })

  it('keeps status subscriber notifications synchronous while deferring the source fact', async () => {
    const ctx = new Context()
    const source = new RuntimeNotificationSource()
    const notifications: RuntimeNotification[] = []
    const collector = new ObserverCollector(ctx, { runtimeNotifications: source })
    source.subscribe(notification => notifications.push(notification))
    let subscriberCalls = 0
    collector.subscribe(() => { subscriberCalls++ })

    ;(ctx.emit as (...args: unknown[]) => unknown)('internal/status', ctx.root, 'active')

    expect(subscriberCalls).toBeGreaterThan(0)
    expect(notifications.filter(notification => notification.type === 'topology-invalidated' && notification.reason === 'snapshot'))
      .toHaveLength(0)

    await Promise.resolve()

    expect(notifications).toContainEqual({ type: 'topology-invalidated', reason: 'snapshot' })
  })
})
