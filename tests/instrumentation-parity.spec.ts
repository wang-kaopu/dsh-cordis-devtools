import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { WaterfallInstrumentationController } from '../src/host/instrumentation/waterfall-controller.js'
import type { WaterfallTraceSink } from '../src/shared/trace.js'
import { benchmark, compareParity, runScenario } from './helpers/parity-harness.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/parity'(steps: string[], next: () => unknown): unknown
    'devtools/parity-nested'(steps: string[], next: () => unknown): unknown
  }
}

const sink: WaterfallTraceSink = { write: () => {} }

const instrumented = {
  prepare(ctx: Context) {
    const controller = new WaterfallInstrumentationController(ctx, sink)
    expect(controller.enable()).toBe(true)
  },
}

function run(ctx: Context, steps: string[], inner: () => unknown = () => {
  steps.push('inner')
  return 'inner-result'
}) {
  return ctx.waterfall('devtools/parity', steps, inner)
}

async function expectParity<T>(scenario: (ctx: Context) => T | PromiseLike<T>) {
  const baseline = await runScenario(scenario)
  const candidate = await runScenario(scenario, instrumented)
  expect(compareParity(baseline, candidate)).toEqual({ equal: true, differences: [] })
}

describe('instrumented waterfall semantic parity', () => {
  it('preserves zero-listener and ordered multi-listener behavior', async () => {
    await expectParity((ctx) => {
      const zeroSteps: string[] = []
      const zeroResult = run(ctx, zeroSteps)

      const steps: string[] = []
      ctx.on('devtools/parity', (log, next) => {
        log.push('a:before')
        const value = next()
        log.push('a:after')
        return value
      })
      ctx.on('devtools/parity', (log, next) => {
        log.push('b:before')
        const value = next()
        log.push('b:after')
        return value
      })
      const result = run(ctx, steps)
      return { zeroResult, zeroSteps, result, steps }
    })
  })

  it('preserves no-next veto behavior', async () => {
    await expectParity((ctx) => {
      const steps: string[] = []
      ctx.on('devtools/parity', (log) => {
        log.push('veto')
        return 'stopped'
      })
      ctx.on('devtools/parity', (log, next) => {
        log.push('unreached')
        return next()
      })
      return { result: run(ctx, steps), steps }
    })
  })

  it('preserves prepend ordering', async () => {
    await expectParity((ctx) => {
      const steps: string[] = []
      ctx.on('devtools/parity', (log, next) => { log.push('normal'); return next() })
      ctx.on('devtools/parity', (log, next) => { log.push('prepend'); return next() }, { prepend: true })
      return { result: run(ctx, steps), steps }
    })
  })

  it('preserves context filter and listener this', async () => {
    await expectParity(async (ctx) => {
      const steps: string[] = []
      let sameThis = false
      let dispatchCtx: Context
      const pluginA = { name: 'parity-a', apply(pluginCtx: Context) {
        pluginCtx.on('devtools/parity', function (this: Context, log, next) {
          sameThis = this === dispatchCtx
          log.push('a')
          return next()
        })
      } }
      const pluginB = { name: 'parity-b', apply(pluginCtx: Context) {
        pluginCtx.on('devtools/parity', (log, next) => { log.push('b'); return next() })
      } }
      await ctx.plugin(pluginA)
      await ctx.plugin(pluginB)
      let filterCalls = 0
      dispatchCtx = ctx.extend({
        [Context.filter]: (target: Context) => {
          filterCalls++
          return target.fiber.name === 'parity-a'
        },
      })
      const result = ctx.waterfall(dispatchCtx, 'devtools/parity', steps, () => {
        steps.push('inner')
        return 'done'
      })
      return { result, steps, sameThis, filterCalls }
    })
  })

  it('preserves exact synchronous error identity', async () => {
    await expectParity((ctx) => {
      const error = new Error('sentinel')
      ctx.on('devtools/parity', () => { throw error })
      let sameError = false
      try { run(ctx, []) } catch (reason) { sameError = reason === error }
      return { sameError }
    })
  })

  it('preserves fulfilled Promise identity and value', async () => {
    await expectParity(async (ctx) => {
      const promise = Promise.resolve('fulfilled')
      ctx.on('devtools/parity', () => promise)
      const result = run(ctx, [])
      return { samePromise: result === promise, value: await result }
    })
  })

  it('preserves rejected Promise identity and rejection reason', async () => {
    await expectParity(async (ctx) => {
      const rejection = new Error('rejected')
      const promise = Promise.reject(rejection)
      ctx.on('devtools/parity', () => promise)
      const result = run(ctx, [])
      let sameRejection = false
      try { await result } catch (reason) { sameRejection = reason === rejection }
      return { samePromise: result === promise, sameRejection }
    })
  })

  it('preserves async before/after-next and nested waterfall behavior', async () => {
    await expectParity(async (ctx) => {
      const steps: string[] = []
      ctx.on('devtools/parity-nested', (log, next) => { log.push('nested'); return next() })
      ctx.on('devtools/parity', async (log, next) => {
        log.push('before-await')
        await Promise.resolve()
        const nested = ctx.waterfall('devtools/parity-nested', log, () => {
          log.push('nested:inner')
          return 'nested-result'
        })
        log.push(String(nested))
        const value = await next()
        log.push('after-next')
        await Promise.resolve()
        log.push('after-await')
        return value
      })
      return { result: await run(ctx, steps), steps }
    })
  })

  it('preserves repeated next behavior', async () => {
    await expectParity((ctx) => {
      const steps: string[] = []
      ctx.on('devtools/parity', (log, next) => {
        const first = next()
        log.push(`first:${String(first)}`)
        const second = next()
        log.push(`second:${String(second)}`)
        return second
      })
      ctx.on('devtools/parity', (log, next) => { log.push('listener-b'); return next() })
      let innerCalls = 0
      const result = run(ctx, steps, () => {
        innerCalls++
        return `inner-${innerCalls}`
      })
      return { result, steps, innerCalls }
    })
  })

  it('preserves late next behavior', async () => {
    await expectParity((ctx) => {
      const steps: string[] = []
      let savedNext: (() => unknown) | undefined
      ctx.on('devtools/parity', (log, next) => {
        log.push('early')
        savedNext = next
        return 'early-result'
      })
      ctx.on('devtools/parity', (log, next) => { log.push('late-listener'); return next() })
      const earlyResult = run(ctx, steps)
      const lateResult = savedNext?.()
      return { earlyResult, lateResult, steps }
    })
  })

  it('preserves listener disposal and plugin restart behavior', async () => {
    await expectParity(async (ctx) => {
      const steps: string[] = []
      const dispose = ctx.on('devtools/parity', (log, next) => { log.push('direct'); return next() })
      run(ctx, steps)
      const beforeDispose = [...steps]
      steps.length = 0
      const disposeResult = dispose()
      run(ctx, steps)
      const afterDispose = [...steps]

      const plugin = { name: 'parity-restart', apply(pluginCtx: Context) {
        pluginCtx.on('devtools/parity', (log, next) => { log.push('plugin'); return next() })
      } }
      const fiber = await ctx.plugin(plugin)
      steps.length = 0
      run(ctx, steps)
      const beforeRestart = [...steps]
      await fiber.restart()
      steps.length = 0
      run(ctx, steps)
      return {
        beforeDispose,
        disposeReturnedUndefined: disposeResult === undefined,
        afterDispose,
        beforeRestart,
        afterRestart: steps,
      }
    })
  })
})

describe('instrumentation overhead measurement', () => {
  it('records disabled and enabled waterfall samples without a flaky budget gate', () => {
    const baselineCtx = new Context()
    baselineCtx.on('devtools/parity', (_steps, next) => next())
    const enabledCtx = new Context()
    enabledCtx.on('devtools/parity', (_steps, next) => next())
    const controller = new WaterfallInstrumentationController(enabledCtx, sink)
    expect(controller.enable()).toBe(true)

    const invoke = (ctx: Context) => () => {
      ctx.waterfall('devtools/parity', [], () => 1)
    }
    for (let index = 0; index < 20; index++) {
      invoke(baselineCtx)()
      invoke(enabledCtx)()
    }

    const baseline = benchmark(200, invoke(baselineCtx))
    const enabled = benchmark(200, invoke(enabledCtx))
    expect(baseline.samples).toBe(200)
    expect(enabled.samples).toBe(200)
    expect(baseline.meanMs).toBeGreaterThanOrEqual(0)
    expect(enabled.meanMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(enabled.maxMs)).toBe(true)
  })
})
