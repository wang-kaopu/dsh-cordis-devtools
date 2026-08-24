import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DevtoolsService } from '../src/host/service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/service-profiler'(steps: string[], next: () => unknown): unknown
  }
}

interface EventsLike {
  dispatch: (type: string, args: unknown[]) => Array<(...args: unknown[]) => unknown>
}

function dispatch(ctx: Context, label: string): unknown {
  const steps: string[] = []
  return ctx.waterfall('devtools/service-profiler', steps, () => label)
}

describe('DevtoolsService profiler integration', () => {
  it('starts disabled and keeps observer snapshot separate from profiler traces', () => {
    const ctx = new Context()
    ctx.on('devtools/service-profiler', (_steps, next) => next())
    const service = new DevtoolsService(ctx)

    expect(service.profilerSnapshot()).toMatchObject({ instrumentation: 'disabled', traces: [] })
    expect(service.snapshot()).not.toHaveProperty('traces')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)

    expect(dispatch(ctx, 'disabled')).toBe('disabled')
    expect(service.profilerSnapshot().traces).toHaveLength(0)
  })

  it('enables explicitly, retains bounded traces, and disables idempotently', () => {
    const ctx = new Context()
    ctx.on('devtools/service-profiler', (_steps, next) => next())
    const service = new DevtoolsService(ctx, { maxTraces: 1 })

    expect(service.setInstrumentationEnabled(true).instrumentation).toBe('enabled')
    expect(service.setInstrumentationEnabled(true).instrumentation).toBe('enabled')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(true)

    expect(dispatch(ctx, 'first')).toBe('first')
    expect(dispatch(ctx, 'second')).toBe('second')
    const profiler = service.profilerSnapshot()
    expect(profiler.instrumentation).toBe('enabled')
    expect(profiler.traces).toHaveLength(1)
    expect(profiler.traces[0].event).toBe('devtools/service-profiler')
    expect(JSON.stringify(profiler)).not.toContain('second')

    expect(service.setInstrumentationEnabled(false).instrumentation).toBe('disabled')
    expect(service.setInstrumentationEnabled(false).instrumentation).toBe('disabled')
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)
  })

  it('disposes an enabled controller without leaving its instance patch installed', () => {
    const ctx = new Context()
    const service = new DevtoolsService(ctx)
    service.setInstrumentationEnabled(true)
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(true)

    service.dispose()
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)
    expect(service.profilerSnapshot().instrumentation).toBe('disabled')
  })

  it('surfaces conflict and does not overwrite a third-party dispatch replacement', () => {
    const ctx = new Context()
    const service = new DevtoolsService(ctx)
    expect(service.setInstrumentationEnabled(true).instrumentation).toBe('enabled')

    const events = ctx.events as unknown as EventsLike
    const thirdParty = (_type: string, _args: unknown[]) => []
    events.dispatch = thirdParty

    const profiler = service.setInstrumentationEnabled(false)
    expect(profiler.instrumentation).toBe('conflict')
    expect(events.dispatch).toBe(thirdParty)
    service.dispose()
    expect(events.dispatch).toBe(thirdParty)
  })
})
