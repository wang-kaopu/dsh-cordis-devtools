import { describe, expect, it } from 'vitest'
import { benchmark, compareParity, runScenario } from './helpers/parity-harness.js'

describe('instrumentation parity harness', () => {
  it('treats identical fresh-runtime observations as parity', async () => {
    const scenario = async () => {
      await Promise.resolve()
      return { order: ['a', 'b'], samePromise: true, sameThis: true }
    }

    const baseline = await runScenario(scenario)
    const candidate = await runScenario(scenario)
    expect(compareParity(baseline, candidate)).toEqual({ equal: true, differences: [] })
  })

  it('reports observable differences without depending on profiler traces', async () => {
    const baseline = await runScenario(() => ({ order: ['a', 'b'], calls: 1 }))
    const candidate = await runScenario(() => ({ order: ['b', 'a'], calls: 1 }))

    expect(compareParity(baseline, candidate)).toEqual({ equal: false, differences: ['value'] })
  })

  it('classifies synchronous throw and async rejection with caller-defined identity tokens', async () => {
    const syncError = new Error('sync')
    const asyncError = new Error('async')
    const token = (reason: unknown) => reason === syncError
      ? 'same-sync-error'
      : reason === asyncError
        ? 'same-async-error'
        : 'other'

    expect(await runScenario(() => { throw syncError }, { errorToken: token })).toEqual({
      outcome: 'threw',
      errorToken: 'same-sync-error',
    })
    expect(await runScenario(() => Promise.reject(asyncError), { errorToken: token })).toEqual({
      outcome: 'rejected',
      errorToken: 'same-async-error',
    })
  })

  it('runs prepare hooks against an isolated Cordis context each time', async () => {
    let prepared = 0
    const options = { prepare: () => { prepared++ } }

    await runScenario(ctx => ctx.root === ctx, options)
    await runScenario(ctx => ctx.root === ctx, options)
    expect(prepared).toBe(2)
  })

  it('records benchmark samples without imposing a performance budget', () => {
    let calls = 0
    const result = benchmark(8, () => { calls++ })

    expect(calls).toBe(8)
    expect(result.samples).toBe(8)
    expect(result.totalMs).toBeGreaterThanOrEqual(0)
    expect(result.meanMs).toBeGreaterThanOrEqual(0)
    expect(result.minMs).toBeGreaterThanOrEqual(0)
    expect(result.maxMs).toBeGreaterThanOrEqual(result.minMs)
  })
})
