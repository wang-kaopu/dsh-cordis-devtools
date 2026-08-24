import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ObserverCollector } from '../src/host/collector.js'
import { DevtoolsService } from '../src/host/service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/release'(payload: unknown): void
    'devtools/release-waterfall'(payload: unknown, next: () => unknown): unknown
  }
}

interface HookLike {
  callback?: (...args: unknown[]) => unknown
}

interface EventsLike {
  _hooks?: Record<PropertyKey, HookLike[]>
  dispatch: (type: string, args: unknown[]) => Array<(...args: unknown[]) => unknown>
}

describe('v0.2 observer release invariants', () => {
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

describe('v0.3 profiler release invariants', () => {
  it('stays disabled by default and keeps bounded metadata-only traces behind explicit enable', () => {
    const ctx = new Context()
    ctx.on('devtools/release-waterfall', (_payload, next) => next())
    const service = new DevtoolsService(ctx, { maxTraces: 1 })
    const secret = 'profiler-raw-payload-must-not-be-retained'

    expect(service.profilerSnapshot()).toMatchObject({ instrumentation: 'disabled', traces: [] })
    expect(service.snapshot()).not.toHaveProperty('traces')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)

    ctx.waterfall('devtools/release-waterfall', { secret }, () => ({ secret }))
    expect(service.profilerSnapshot().traces).toHaveLength(0)

    expect(service.setInstrumentationEnabled(true).instrumentation).toBe('enabled')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(true)

    ctx.waterfall('devtools/release-waterfall', { secret }, () => ({ secret }))
    ctx.waterfall('devtools/release-waterfall', { secret }, () => ({ secret }))

    const profiler = service.profilerSnapshot()
    expect(profiler.traces).toHaveLength(1)
    expect(profiler.traces[0]).toMatchObject({
      mode: 'waterfall',
      event: 'devtools/release-waterfall',
    })
    const serialized = JSON.stringify(profiler)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('selfTime')
    expect(serialized).not.toContain('shortCircuit')
    expect(serialized).not.toContain('veto')

    expect(service.setInstrumentationEnabled(false).instrumentation).toBe('disabled')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)
  })

  it('fails closed when another runtime patch owns dispatch during disable', () => {
    const ctx = new Context()
    const service = new DevtoolsService(ctx)
    expect(service.setInstrumentationEnabled(true).instrumentation).toBe('enabled')

    const events = ctx.events as unknown as EventsLike
    const thirdParty = (_type: string, _args: unknown[]) => []
    events.dispatch = thirdParty

    expect(service.setInstrumentationEnabled(false).instrumentation).toBe('conflict')
    expect(events.dispatch).toBe(thirdParty)
    service.dispose()
    expect(events.dispatch).toBe(thirdParty)
  })
})
