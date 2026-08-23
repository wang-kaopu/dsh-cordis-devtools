import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ObserverCollector } from '../src/host/collector.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/test'(): void
    'devtools/reload'(): void
    'devtools/notify'(): void
  }
}

describe('Event / Listener Registry', () => {
  it('snapshots live listeners in Cordis order without changing dispatch behavior', async () => {
    const ctx = new Context()
    const calls: string[] = []

    const pluginA = {
      name: 'plugin-a',
      apply(pluginCtx: Context) {
        pluginCtx.on('devtools/test', () => calls.push('a'))
      },
    }
    const pluginB = {
      name: 'plugin-b',
      apply(pluginCtx: Context) {
        const shared = () => calls.push('b')
        pluginCtx.on('devtools/test', shared, { prepend: true, global: true })
        pluginCtx.on('devtools/test', shared)
      },
    }

    const fiberA = await ctx.plugin(pluginA)
    const fiberB = await ctx.plugin(pluginB)

    ctx.emit('devtools/test')
    expect(calls).toEqual(['b', 'a', 'b'])
    calls.length = 0

    const collector = new ObserverCollector(ctx)
    const first = collector.snapshot()
    const listeners = first.listeners.filter(listener => listener.event === 'devtools/test')

    expect(listeners).toHaveLength(3)
    expect(listeners.map(listener => listener.order)).toEqual([0, 1, 2])
    expect(listeners.map(listener => listener.owner?.name)).toEqual(['plugin-b', 'plugin-a', 'plugin-b'])
    expect(listeners.map(listener => listener.prepend)).toEqual([true, false, false])
    expect(listeners.map(listener => listener.global)).toEqual([true, false, false])
    expect(listeners[0].owner).toMatchObject({ uid: fiberB.uid, state: String(fiberB.state) })
    expect(listeners[1].owner).toMatchObject({ uid: fiberA.uid, state: String(fiberA.state) })

    const ids = listeners.map(listener => listener.id)
    expect(new Set(ids).size).toBe(3)
    expect(first.events.find(event => event.name === 'devtools/test')).toEqual({
      name: 'devtools/test',
      listenerCount: 3,
      listenerIds: ids,
    })

    const secondIds = collector.snapshot().listeners
      .filter(listener => listener.event === 'devtools/test')
      .map(listener => listener.id)
    expect(secondIds).toEqual(ids)

    ctx.emit('devtools/test')
    expect(calls).toEqual(['b', 'a', 'b'])
    expect(collector.snapshot().dispatches.at(-1)).toMatchObject({
      event: 'devtools/test',
      mode: 'emit',
      registeredListeners: 3,
    })
  })

  it('reflects restart and disposal from the live Cordis registry', async () => {
    const ctx = new Context()
    const collector = new ObserverCollector(ctx)
    const plugin = {
      name: 'reloadable-plugin',
      apply(pluginCtx: Context) {
        pluginCtx.on('devtools/reload', () => {})
      },
    }

    const fiber = await ctx.plugin(plugin)
    await Promise.resolve()

    let listeners = collector.snapshot().listeners.filter(listener => listener.event === 'devtools/reload')
    expect(listeners).toHaveLength(1)
    expect(listeners[0].owner?.name).toBe('reloadable-plugin')

    await fiber.restart()
    await Promise.resolve()

    listeners = collector.snapshot().listeners.filter(listener => listener.event === 'devtools/reload')
    expect(listeners).toHaveLength(1)
    expect(collector.snapshot().events.find(event => event.name === 'devtools/reload')?.listenerCount).toBe(1)

    await fiber.dispose()
    await Promise.resolve()

    expect(collector.snapshot().listeners.filter(listener => listener.event === 'devtools/reload')).toHaveLength(0)
    expect(collector.snapshot().events.find(event => event.name === 'devtools/reload')).toBeUndefined()
  })

  it('notifies subscribers after a listener has entered the live registry', async () => {
    const ctx = new Context()
    const collector = new ObserverCollector(ctx)
    let notificationCount = 0
    let sawRegisteredListener = false

    const unsubscribe = collector.subscribe(() => {
      notificationCount++
      sawRegisteredListener ||= collector.snapshot().events.some(event => event.name === 'devtools/notify')
    })

    ctx.on('devtools/notify', () => {})

    expect(notificationCount).toBe(0)
    expect(sawRegisteredListener).toBe(false)

    await Promise.resolve()

    expect(notificationCount).toBe(1)
    expect(sawRegisteredListener).toBe(true)
    unsubscribe()
  })
})
