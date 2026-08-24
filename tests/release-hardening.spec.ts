import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ObserverCollector } from '../src/host/collector.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/release'(payload: unknown): void
  }
}

interface HookLike {
  callback?: (...args: unknown[]) => unknown
}

interface EventsLike {
  _hooks?: Record<PropertyKey, HookLike[]>
}

describe('v0.2 release invariants', () => {
  it('keeps dispatch history bounded and does not retain raw arguments', () => {
    const ctx = new Context()
    const collector = new ObserverCollector(ctx, { maxDispatches: 2 })
    const secret = 'raw-payload-must-not-enter-snapshot'

    ctx.emit('devtools/release', { sequence: 1, secret })
    ctx.emit('devtools/release', { sequence: 2, secret })
    ctx.emit('devtools/release', { sequence: 3, secret })

    const snapshot = collector.snapshot()
    const records = snapshot.dispatches.filter(record => record.event === 'devtools/release')

    expect(records).toHaveLength(2)
    expect(records.map(record => record.argCount)).toEqual([1, 1])
    expect(JSON.stringify(snapshot)).not.toContain(secret)
  })

  it('does not replace an existing target listener callback in observer mode', () => {
    const ctx = new Context()
    const target = () => {}
    ctx.on('devtools/release', target)

    const hooks = (ctx.events as unknown as EventsLike)._hooks?.['devtools/release']
    const callbackBefore = hooks?.[0]?.callback
    expect(callbackBefore).toBeTypeOf('function')

    const collector = new ObserverCollector(ctx)
    collector.snapshot()

    const callbackAfter = (ctx.events as unknown as EventsLike)._hooks?.['devtools/release']?.[0]?.callback
    expect(callbackAfter).toBe(callbackBefore)
  })
})
