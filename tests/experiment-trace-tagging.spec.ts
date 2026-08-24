import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { WaterfallInstrumentationController } from '../src/host/instrumentation/waterfall-controller.js'
import type { WaterfallDispatchTrace, WaterfallTraceSink } from '../src/shared/trace.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/experiment-trace'(next: () => unknown): unknown
  }
}

class MemorySink implements WaterfallTraceSink {
  readonly rows = new Map<string, WaterfallDispatchTrace>()

  write(trace: WaterfallDispatchTrace): void {
    this.rows.set(trace.id, structuredClone(trace))
  }

  traces(): WaterfallDispatchTrace[] {
    return [...this.rows.values()]
  }
}

describe('waterfall experiment trace association', () => {
  it('captures experimentId once at trace creation and keeps it through late settlement', async () => {
    const ctx = new Context()
    const sink = new MemorySink()
    let experimentId: string | undefined = 'lease-a'
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => { resolve = done })

    ctx.on('devtools/experiment-trace', () => pending)
    const controller = new WaterfallInstrumentationController(ctx, sink, {
      resolveExperimentId: () => experimentId,
    })
    controller.enable()

    const result = ctx.waterfall('devtools/experiment-trace', () => 'fallback')
    expect(result).toBe(pending)
    expect(sink.traces()).toHaveLength(1)
    expect(sink.traces()[0]).toMatchObject({ experimentId: 'lease-a', outcome: 'pending' })

    experimentId = undefined
    resolve('done')
    await pending
    await Promise.resolve()

    expect(sink.traces()[0]).toMatchObject({ experimentId: 'lease-a', outcome: 'fulfilled' })
  })

  it('leaves Human/unowned traces untagged and does not inherit a stale lease id', () => {
    const ctx = new Context()
    const sink = new MemorySink()
    let experimentId: string | undefined = 'lease-a'
    ctx.on('devtools/experiment-trace', next => next())
    const controller = new WaterfallInstrumentationController(ctx, sink, {
      resolveExperimentId: () => experimentId,
    })
    controller.enable()

    ctx.waterfall('devtools/experiment-trace', () => 'first')
    experimentId = undefined
    ctx.waterfall('devtools/experiment-trace', () => 'second')

    const traces = sink.traces()
    expect(traces).toHaveLength(2)
    expect(traces[0].experimentId).toBe('lease-a')
    expect(traces[1]).not.toHaveProperty('experimentId')
  })
})
