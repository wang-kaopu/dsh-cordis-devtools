import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { WaterfallInstrumentationController } from '../src/host/instrumentation/waterfall-controller.js'
import type { WaterfallDispatchTrace, WaterfallTraceSink } from '../src/shared/trace.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/instrumented'(steps: string[], next: () => unknown): unknown
    'devtools/non-waterfall'(steps: string[]): void
  }
}

interface HookLike {
  callback: (...args: unknown[]) => unknown
}

interface EventsLike {
  _hooks: Record<PropertyKey, HookLike[]>
  dispatch: (type: string, args: unknown[]) => Array<(...args: unknown[]) => unknown>
}

class MemorySink implements WaterfallTraceSink {
  readonly rows = new Map<string, WaterfallDispatchTrace>()
  write(trace: WaterfallDispatchTrace): void {
    this.rows.set(trace.id, trace)
  }
  latest(): WaterfallDispatchTrace {
    const row = [...this.rows.values()].at(-1)
    if (row === undefined) throw new Error('missing trace')
    return row
  }
}

function clock() {
  let value = 0
  return () => ++value
}

function waterfall(ctx: Context, steps: string[], inner: () => unknown = () => {
  steps.push('inner')
  return 'inner-result'
}) {
  return ctx.waterfall('devtools/instrumented', steps, inner)
}

describe('WaterfallInstrumentationController', () => {
  it('does not patch or emit traces while disabled', () => {
    const ctx = new Context()
    const sink = new MemorySink()
    const controller = new WaterfallInstrumentationController(ctx, sink, { now: clock() })
    const events = ctx.events as unknown as EventsLike

    expect(controller.state).toBe('disabled')
    expect(Object.prototype.hasOwnProperty.call(events, 'dispatch')).toBe(false)
    expect(waterfall(ctx, [])).toBe('inner-result')
    expect(sink.rows.size).toBe(0)
  })

  it('patches only the instance, delegates non-waterfall, and restores cleanly', () => {
    const ctx = new Context()
    const sink = new MemorySink()
    const steps: string[] = []
    ctx.on('devtools/non-waterfall', log => { log.push('emit') })
    const controller = new WaterfallInstrumentationController(ctx, sink, { now: clock() })
    const events = ctx.events as unknown as EventsLike

    expect(controller.enable()).toBe(true)
    expect(controller.enable()).toBe(true)
    expect(controller.state).toBe('enabled')
    expect(Object.prototype.hasOwnProperty.call(events, 'dispatch')).toBe(true)

    ctx.emit('devtools/non-waterfall', steps)
    expect(steps).toEqual(['emit'])
    expect(sink.rows.size).toBe(0)

    expect(controller.disable()).toBe(true)
    expect(controller.disable()).toBe(true)
    expect(controller.state).toBe('disabled')
    expect(Object.prototype.hasOwnProperty.call(events, 'dispatch')).toBe(false)
  })

  it('keeps Hook callback identity and records listener/next metadata', () => {
    const ctx = new Context()
    const sink = new MemorySink()
    const steps: string[] = []
    ctx.on('devtools/instrumented', (log, next) => {
      log.push('listener')
      return next()
    })
    const events = ctx.events as unknown as EventsLike
    const callback = events._hooks['devtools/instrumented'][0].callback
    const controller = new WaterfallInstrumentationController(ctx, sink, { now: clock() })

    controller.enable()
    expect(waterfall(ctx, steps)).toBe('inner-result')
    expect(steps).toEqual(['listener', 'inner'])
    expect(events._hooks['devtools/instrumented'][0].callback).toBe(callback)

    const trace = sink.latest()
    expect(trace.event).toBe('devtools/instrumented')
    expect(trace.outcome).toBe('returned')
    expect(trace.listeners).toHaveLength(1)
    expect(trace.listeners[0].outcome).toBe('returned')
    expect(trace.listeners[0].nextCalls).toHaveLength(1)
    expect(trace.listeners[0].nextCalls[0].outcome).toBe('returned')
    expect(JSON.stringify(trace)).not.toContain('inner-result')
  })

  it('evaluates each selected filter at most once and preserves dispatch this', async () => {
    const ctx = new Context()
    const sink = new MemorySink()
    let filterCalls = 0
    let seenThis: unknown
    const a = { name: 'i2-a', apply(pluginCtx: Context) {
      pluginCtx.on('devtools/instrumented', function (this: Context, log, next) {
        seenThis = this
        log.push('a')
        return next()
      })
    } }
    const b = { name: 'i2-b', apply(pluginCtx: Context) {
      pluginCtx.on('devtools/instrumented', (log, next) => { log.push('b'); return next() })
    } }
    await ctx.plugin(a)
    await ctx.plugin(b)

    const dispatchCtx = ctx.extend({
      [Context.filter]: (target: Context) => {
        filterCalls++
        return target.fiber.name === 'i2-a'
      },
    })
    const controller = new WaterfallInstrumentationController(ctx, sink, { now: clock() })
    controller.enable()
    const steps: string[] = []
    const result = ctx.waterfall(dispatchCtx, 'devtools/instrumented', steps, () => {
      steps.push('inner')
      return 'done'
    })

    expect(result).toBe('done')
    expect(steps).toEqual(['a', 'inner'])
    expect(filterCalls).toBe(2)
    expect(seenThis).toBe(dispatchCtx)
    expect(sink.latest().listeners).toHaveLength(1)
  })

  it('preserves exact synchronous error and Promise identities', async () => {
    const errorCtx = new Context()
    const errorSink = new MemorySink()
    const error = new Error('same-error')
    errorCtx.on('devtools/instrumented', () => { throw error })
    const errorController = new WaterfallInstrumentationController(errorCtx, errorSink, { now: clock() })
    errorController.enable()

    let caught: unknown
    try { waterfall(errorCtx, []) } catch (reason) { caught = reason }
    expect(caught).toBe(error)
    expect(errorSink.latest().outcome).toBe('threw')

    const promiseCtx = new Context()
    const promiseSink = new MemorySink()
    const promise = Promise.resolve('same-promise')
    promiseCtx.on('devtools/instrumented', () => promise)
    const promiseController = new WaterfallInstrumentationController(promiseCtx, promiseSink, { now: clock() })
    promiseController.enable()

    const result = waterfall(promiseCtx, [])
    expect(result).toBe(promise)
    await expect(result).resolves.toBe('same-promise')
    await Promise.resolve()
    expect(promiseSink.latest().outcome).toBe('fulfilled')
  })

  it('records repeated and late next calls without blocking them', () => {
    const repeatedCtx = new Context()
    const repeatedSink = new MemorySink()
    repeatedCtx.on('devtools/instrumented', (_log, next) => {
      next()
      return next()
    })
    repeatedCtx.on('devtools/instrumented', (_log, next) => next())
    const repeatedController = new WaterfallInstrumentationController(repeatedCtx, repeatedSink, { now: clock() })
    repeatedController.enable()
    let innerCalls = 0
    waterfall(repeatedCtx, [], () => ++innerCalls)
    expect(innerCalls).toBe(2)
    expect(repeatedSink.latest().listeners[0].nextCalls).toHaveLength(2)

    const lateCtx = new Context()
    const lateSink = new MemorySink()
    let savedNext: (() => unknown) | undefined
    lateCtx.on('devtools/instrumented', (_log, next) => {
      savedNext = next
      return 'early'
    })
    lateCtx.on('devtools/instrumented', (_log, next) => next())
    const lateController = new WaterfallInstrumentationController(lateCtx, lateSink, { now: clock() })
    lateController.enable()

    expect(waterfall(lateCtx, [])).toBe('early')
    expect(lateSink.latest().listeners).toHaveLength(1)
    expect(savedNext?.()).toBe('inner-result')
    expect(lateSink.latest().listeners).toHaveLength(2)
    expect(lateSink.latest().listeners[0].nextCalls).toHaveLength(1)
  })

  it('fails closed when dispatch is already patched or overwritten during instrumentation', () => {
    const prepatchedCtx = new Context()
    const prepatchedEvents = prepatchedCtx.events as unknown as EventsLike
    const previous = prepatchedEvents.dispatch
    Object.defineProperty(prepatchedEvents, 'dispatch', {
      configurable: true,
      writable: true,
      value: previous,
    })
    const prepatched = new WaterfallInstrumentationController(prepatchedCtx, new MemorySink())
    expect(prepatched.enable()).toBe(false)
    expect(prepatched.state).toBe('conflict')

    const ctx = new Context()
    const events = ctx.events as unknown as EventsLike
    const controller = new WaterfallInstrumentationController(ctx, new MemorySink())
    expect(controller.enable()).toBe(true)
    const thirdParty = function (_type: string, _args: unknown[]) { return [] }
    events.dispatch = thirdParty

    expect(controller.disable()).toBe(false)
    expect(controller.state).toBe('conflict')
    expect(events.dispatch).toBe(thirdParty)
  })
})
