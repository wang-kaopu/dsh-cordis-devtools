import { describe, expect, it } from 'vitest'
import { RuntimeDiagnosticsQuery, type RuntimeDiagnosticsSource } from '../src/host/diagnostics.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

function runtime(uidA: number, uidB?: number): DevtoolsSnapshot {
  const uids = uidB === undefined ? [uidA] : [uidA, uidB]
  return {
    generatedAt: uidA,
    events: [{ name: 'event', listenerCount: uids.length, listenerIds: uids.map((_, index) => index + 1) }],
    listeners: uids.map((uid, index) => ({
      id: index + 100,
      event: 'event',
      order: 0,
      prepend: false,
      global: false,
      owner: { uid, name: 'Plugin', state: 'active' },
    })),
    fibers: uids.map(uid => ({
      uid,
      name: 'Plugin',
      state: 'active',
      parent: { uid: 1, name: 'root', state: 'active' },
      inject: [],
      effects: [],
    })),
    dispatches: [],
  }
}

const profiler: WaterfallProfilerSnapshot = {
  generatedAt: 0,
  instrumentation: 'disabled',
  traces: [],
}

describe('RuntimeDiagnosticsQuery verification', () => {
  it('captures a caller-owned scoped checkpoint and compares against fresh current state', () => {
    let observer = runtime(10, 11)
    const source: RuntimeDiagnosticsSource = {
      snapshot: () => observer,
      profilerSnapshot: () => profiler,
    }
    const query = new RuntimeDiagnosticsQuery(source)

    const baseline = query.captureCheckpoint({ scope: { fiberNames: ['Plugin'] } })
    expect(baseline.fibers).toHaveLength(2)
    expect(baseline.listeners).toHaveLength(2)

    observer = runtime(99)
    const comparison = query.compareCurrent({ baseline })

    expect(comparison.changed).toBe(true)
    expect(comparison.current.fibers.map(fiber => fiber.uid)).toEqual([99])
    expect(comparison.events).toEqual([{ name: 'event', beforeListenerCount: 2, afterListenerCount: 1, delta: -1 }])
    expect(comparison.listenerGroups[0]).toMatchObject({ beforeCount: 2, afterCount: 1, delta: -1 })
    expect(comparison.fiberGroups[0]).toMatchObject({ beforeCount: 2, afterCount: 1, delta: -1 })
  })

  it('does not report runtime-local id churn as semantic change', () => {
    let observer = runtime(10)
    const query = new RuntimeDiagnosticsQuery({
      snapshot: () => observer,
      profilerSnapshot: () => profiler,
    })
    const baseline = query.captureCheckpoint()

    observer = runtime(500)
    const comparison = query.compareCurrent({ baseline })
    expect(comparison.changed).toBe(false)
  })

  it('rejects a tampered baseline before comparing live state', () => {
    const observer = runtime(10)
    const query = new RuntimeDiagnosticsQuery({
      snapshot: () => observer,
      profilerSnapshot: () => profiler,
    })
    const baseline = query.captureCheckpoint()
    baseline.fibers[0]!.name = 'Tampered'

    expect(() => query.compareCurrent({ baseline })).toThrow('baseline checkpoint digest does not match checkpoint body')
  })
})
