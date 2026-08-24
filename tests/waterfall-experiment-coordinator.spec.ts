import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WaterfallInstrumentationState } from '../src/shared/trace.js'
import { WaterfallExperimentCoordinator } from '../src/host/instrumentation/waterfall-experiment-coordinator.js'

class FakeInstrumentation {
  state: WaterfallInstrumentationState = 'disabled'
  enableCalls = 0
  disableCalls = 0

  enable(): boolean {
    this.enableCalls += 1
    if (this.state !== 'disabled') return false
    this.state = 'enabled'
    return true
  }

  disable(): boolean {
    this.disableCalls += 1
    if (this.state !== 'enabled') return false
    this.state = 'disabled'
    return true
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WaterfallExperimentCoordinator', () => {
  it('starts one finite Agent lease and expires only that lease', () => {
    vi.useFakeTimers()
    let now = 1_000
    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      now: () => now,
      createLeaseId: () => 'lease-a',
    })

    const started = coordinator.startAgent('dsh', { ttlMs: 5_000 })
    expect(started).toMatchObject({
      outcome: 'started',
      lease: { leaseId: 'lease-a', source: 'dsh', startedAt: 1_000, expiresAt: 6_000 },
      status: { instrumentation: 'enabled', owner: { kind: 'agent', leaseId: 'lease-a' } },
    })
    expect(coordinator.currentExperimentId()).toBe('lease-a')

    now = 6_000
    vi.advanceTimersByTime(5_000)
    expect(instrumentation.disableCalls).toBe(1)
    expect(coordinator.status()).toMatchObject({ instrumentation: 'disabled', owner: { kind: 'none' } })
  })

  it('rejects busy starts without touching the controller', () => {
    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => 'lease-a',
    })

    expect(coordinator.startAgent('mcp').outcome).toBe('started')
    const second = coordinator.startAgent('dsh')
    expect(second.outcome).toBe('busy')
    expect(second.lease).toBeNull()
    expect(instrumentation.enableCalls).toBe(1)
    coordinator.dispose()
  })

  it('requires the exact current lease id to stop', () => {
    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => 'lease-a',
    })
    coordinator.startAgent('mcp')

    expect(coordinator.stopAgent({ leaseId: 'stale' })).toMatchObject({
      outcome: 'lease-mismatch',
      status: { owner: { kind: 'agent', leaseId: 'lease-a' } },
    })
    expect(instrumentation.disableCalls).toBe(0)

    expect(coordinator.stopAgent({ leaseId: 'lease-a' })).toMatchObject({
      outcome: 'stopped',
      status: { instrumentation: 'disabled', owner: { kind: 'none' } },
    })
    expect(instrumentation.disableCalls).toBe(1)
  })

  it('does not let a stale timeout disable a later lease', () => {
    vi.useFakeTimers()
    const ids = ['lease-a', 'lease-b']
    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => ids.shift()!,
    })

    coordinator.startAgent('dsh', { ttlMs: 1_000 })
    coordinator.stopAgent({ leaseId: 'lease-a' })
    coordinator.startAgent('dsh', { ttlMs: 5_000 })

    vi.advanceTimersByTime(1_000)
    expect(coordinator.status()).toMatchObject({
      instrumentation: 'enabled',
      owner: { kind: 'agent', leaseId: 'lease-b' },
    })
    expect(instrumentation.disableCalls).toBe(1)

    coordinator.dispose()
  })

  it('keeps Human ownership from being stolen and permits Human emergency stop', () => {
    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => 'lease-a',
    })

    expect(coordinator.startHuman()).toMatchObject({ instrumentation: 'enabled', owner: { kind: 'human' } })
    expect(coordinator.startAgent('dsh').outcome).toBe('busy')
    expect(instrumentation.enableCalls).toBe(1)
    coordinator.stopHuman()

    coordinator.startAgent('dsh')
    expect(coordinator.forceStop()).toMatchObject({ instrumentation: 'disabled', owner: { kind: 'none' } })
    expect(coordinator.stopAgent({ leaseId: 'lease-a' }).outcome).toBe('not-active')
  })

  it('propagates unsupported/conflict starts and fails closed on cleanup conflict', () => {
    const unsupported = new FakeInstrumentation()
    unsupported.state = 'unsupported'
    const unsupportedCoordinator = new WaterfallExperimentCoordinator(unsupported)
    expect(unsupportedCoordinator.startAgent('dsh').outcome).toBe('unsupported')
    expect(unsupported.enableCalls).toBe(0)

    const conflicted = new FakeInstrumentation()
    conflicted.state = 'conflict'
    const conflictCoordinator = new WaterfallExperimentCoordinator(conflicted)
    expect(conflictCoordinator.startAgent('mcp').outcome).toBe('conflict')
    expect(conflicted.enableCalls).toBe(0)

    const instrumentation = new FakeInstrumentation()
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => 'lease-a',
    })
    coordinator.startAgent('dsh')
    instrumentation.state = 'conflict'
    expect(coordinator.stopAgent({ leaseId: 'lease-a' })).toMatchObject({
      outcome: 'conflict',
      status: { instrumentation: 'conflict', owner: { kind: 'none' } },
    })
  })

  it('rejects non-finite, non-positive, and over-max TTL requests', () => {
    const coordinator = new WaterfallExperimentCoordinator(new FakeInstrumentation())
    expect(() => coordinator.startAgent('dsh', { ttlMs: 0 })).toThrow(RangeError)
    expect(() => coordinator.startAgent('dsh', { ttlMs: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => coordinator.startAgent('dsh', { ttlMs: 60_001 })).toThrow(RangeError)
  })
})
