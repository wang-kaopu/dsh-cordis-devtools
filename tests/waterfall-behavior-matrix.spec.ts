import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/matrix'(steps: string[], next: () => unknown): unknown
    'devtools/nested'(steps: string[], next: () => unknown): unknown
  }
}

function run(ctx: Context, steps: string[], inner: () => unknown = () => {
  steps.push('inner')
  return 'inner-result'
}) {
  return ctx.waterfall('devtools/matrix', steps, inner)
}

describe('Cordis 4.0.1 waterfall behavior matrix', () => {
  it('runs the innermost callback when there are zero listeners', () => {
    const ctx = new Context()
    const steps: string[] = []
    expect(run(ctx, steps)).toBe('inner-result')
    expect(steps).toEqual(['inner'])
  })

  it('preserves outer-to-inner and after-next ordering', () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/matrix', (log, next) => {
      log.push('a:before')
      const value = next()
      log.push('a:after')
      return value
    })
    ctx.on('devtools/matrix', (log, next) => {
      log.push('b:before')
      const value = next()
      log.push('b:after')
      return value
    })

    expect(run(ctx, steps)).toBe('inner-result')
    expect(steps).toEqual(['a:before', 'b:before', 'inner', 'b:after', 'a:after'])
  })

  it('allows a listener to veto downstream by not calling next', () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/matrix', (log) => {
      log.push('veto')
      return 'stopped'
    })
    ctx.on('devtools/matrix', (log, next) => {
      log.push('unreached')
      return next()
    })

    expect(run(ctx, steps)).toBe('stopped')
    expect(steps).toEqual(['veto'])
  })

  it('honors prepend ordering', () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/matrix', (log, next) => { log.push('normal'); return next() })
    ctx.on('devtools/matrix', (log, next) => { log.push('prepend'); return next() }, { prepend: true })

    run(ctx, steps)
    expect(steps).toEqual(['prepend', 'normal', 'inner'])
  })

  it('evaluates the dispatch context filter and preserves listener this', async () => {
    const ctx = new Context()
    const steps: string[] = []
    let seenThis: unknown
    const pluginA = { name: 'matrix-a', apply(pluginCtx: Context) {
      pluginCtx.on('devtools/matrix', function (this: Context, log, next) {
        seenThis = this
        log.push('a')
        return next()
      })
    } }
    const pluginB = { name: 'matrix-b', apply(pluginCtx: Context) {
      pluginCtx.on('devtools/matrix', (log, next) => { log.push('b'); return next() })
    } }
    await ctx.plugin(pluginA)
    await ctx.plugin(pluginB)

    const dispatchCtx = ctx.extend({
      [Context.filter]: (target: Context) => target.fiber.name === 'matrix-a',
    })
    const result = ctx.waterfall(dispatchCtx, 'devtools/matrix', steps, () => {
      steps.push('inner')
      return 'done'
    })

    expect(result).toBe('done')
    expect(steps).toEqual(['a', 'inner'])
    expect(seenThis).toBe(dispatchCtx)
  })

  it('rethrows the exact same synchronous error object', () => {
    const ctx = new Context()
    const error = new Error('sentinel')
    ctx.on('devtools/matrix', () => { throw error })

    let caught: unknown
    try { run(ctx, []) } catch (reason) { caught = reason }
    expect(caught).toBe(error)
  })

  it('returns the exact listener promise and preserves fulfillment', async () => {
    const ctx = new Context()
    const promise = Promise.resolve('async-result')
    ctx.on('devtools/matrix', () => promise)

    const result = run(ctx, [])
    expect(result).toBe(promise)
    await expect(result).resolves.toBe('async-result')
  })

  it('returns the exact rejected promise and preserves rejection reason', async () => {
    const ctx = new Context()
    const error = new Error('reject-sentinel')
    const promise = Promise.reject(error)
    ctx.on('devtools/matrix', () => promise)

    const result = run(ctx, [])
    expect(result).toBe(promise)
    await expect(result).rejects.toBe(error)
  })

  it('preserves async work before and after next', async () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/matrix', async (log, next) => {
      log.push('before-await')
      await Promise.resolve()
      log.push('before-next')
      const value = await next()
      log.push('after-next')
      await Promise.resolve()
      log.push('after-await')
      return value
    })

    await expect(run(ctx, steps)).resolves.toBe('inner-result')
    expect(steps).toEqual(['before-await', 'before-next', 'inner', 'after-next', 'after-await'])
  })

  it('keeps nested waterfall invocations independent', () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/nested', (log, next) => { log.push('nested'); return next() })
    ctx.on('devtools/matrix', (log, next) => {
      log.push('outer:before')
      const nested = ctx.waterfall('devtools/nested', log, () => { log.push('nested:inner'); return 'nested-result' })
      log.push(String(nested))
      const value = next()
      log.push('outer:after')
      return value
    })

    expect(run(ctx, steps)).toBe('inner-result')
    expect(steps).toEqual(['outer:before', 'nested', 'nested:inner', 'nested-result', 'inner', 'outer:after'])
  })

  it('allows repeated next calls to keep consuming the original continuation', () => {
    const ctx = new Context()
    const steps: string[] = []
    ctx.on('devtools/matrix', (log, next) => {
      log.push('a')
      const first = next()
      log.push(`first:${String(first)}`)
      const second = next()
      log.push(`second:${String(second)}`)
      return second
    })
    ctx.on('devtools/matrix', (log, next) => {
      log.push('b')
      return next()
    })

    let innerCalls = 0
    const result = run(ctx, steps, () => {
      innerCalls++
      steps.push(`inner:${innerCalls}`)
      return `inner-${innerCalls}`
    })

    expect(result).toBe('inner-2')
    expect(steps).toEqual(['a', 'b', 'inner:1', 'first:inner-1', 'inner:2', 'second:inner-2'])
  })

  it('allows a saved next continuation to be called after the listener returned', () => {
    const ctx = new Context()
    const steps: string[] = []
    let savedNext: (() => unknown) | undefined
    ctx.on('devtools/matrix', (log, next) => {
      log.push('outer:return')
      savedNext = next
      return 'early'
    })
    ctx.on('devtools/matrix', (log, next) => {
      log.push('late:listener')
      return next()
    })

    expect(run(ctx, steps)).toBe('early')
    expect(steps).toEqual(['outer:return'])
    expect(savedNext?.()).toBe('inner-result')
    expect(steps).toEqual(['outer:return', 'late:listener', 'inner'])
  })

  it('tracks listener disposal and plugin restart through the same runtime', async () => {
    const ctx = new Context()
    const steps: string[] = []
    const dispose = ctx.on('devtools/matrix', (log, next) => { log.push('direct'); return next() })
    run(ctx, steps)
    expect(steps).toEqual(['direct', 'inner'])

    steps.length = 0
    expect(dispose()).toBeUndefined()
    run(ctx, steps)
    expect(steps).toEqual(['inner'])

    const plugin = { name: 'matrix-restart', apply(pluginCtx: Context) {
      pluginCtx.on('devtools/matrix', (log, next) => { log.push('plugin'); return next() })
    } }
    const fiber = await ctx.plugin(plugin)
    steps.length = 0
    run(ctx, steps)
    expect(steps).toEqual(['plugin', 'inner'])

    await fiber.restart()
    steps.length = 0
    run(ctx, steps)
    expect(steps).toEqual(['plugin', 'inner'])
  })
})
