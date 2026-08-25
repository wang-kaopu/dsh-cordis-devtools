import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WaterfallInstrumentationState } from '../src/shared/trace.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import { WaterfallExperimentCoordinator } from '../src/host/instrumentation/waterfall-experiment-coordinator.js'

class FakeInstrumentation {
  state: WaterfallInstrumentationState = 'disabled'
  enableCalls = 0
  disableCalls = 0
  failEnable = false
  failedEnableState: WaterfallInstrumentationState | undefined
  failDisable = false

  enable(): boolean {
    this.enableCalls += 1
    if (this.failEnable) {
      if (this.failedEnableState !== undefined) this.state = this.failedEnableState
      return false
    }
    if (this.state !== 'disabled') return false
    this.state = 'enabled'
    return true
  }

  disable(): boolean {
    this.disableCalls += 1
    if (this.failDisable || this.state !== 'enabled') return false
    this.state = 'disabled'
    return true
  }
}

function profilerStates(source: RuntimeNotificationSource): WaterfallInstrumentationState[] {
  const states: WaterfallInstrumentationState[] = []
  source.subscribe(notification => {
    if (notification.type === 'profiler-status-changed') states.push(notification.instrumentation)
  })
  return states
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WaterfallExperimentCoordinator profiler notifications', () => {
  it('publishes only logical Agent start/stop changes, not status reads or rejected requests', () => {
    const instrumentation = new FakeInstrumentation()
    const source = new RuntimeNotificationSource()
    const states = profilerStates(source)
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      now: (() => {
        let value = 1_000
        return () => value++
      })(),
      createLeaseId: () => 'lease-a',
      runtimeNotifications: source,
    })

    expect(coordinator.startAgent('dsh').outcome).toBe('started')
    coordinator.status()
    expect(coordinator.startAgent('mcp').outcome).toBe('busy')
    expect(coordinator.stopAgent({ leaseId: 'stale' }).outcome).toBe('lease-mismatch')
    expect(states).toEqual(['enabled'])

    expect(coordinator.stopAgent({ leaseId: 'lease-a' }).outcome).toBe('stopped')
    expect(coordinator.stopAgent({ leaseId: 'lease-a' }).outcome).toBe('not-active')
    expect(states).toEqual(['enabled', 'disabled'])
  })

  it('publishes Agent expiry after the lease owner and instrumentation are released', () => {
    vi.useFakeTimers()
    const instrumentation = new FakeInstrumentation()
    const source = new RuntimeNotificationSource()
    const states = profilerStates(source)
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, {
      createLeaseId: () => 'lease-a',
      runtimeNotifications: source,
    })

    coordinator.startAgent('dsh', { ttlMs: 1_000 })
    vi.advanceTimersByTime(1_000)

    expect(coordinator.status()).toMatchObject({ instrumentation: 'disabled', owner: { kind: 'none' } })
    expect(states).toEqual(['enabled', 'disabled'])
  })

  it('publishes Human start, stop, force-stop, and disposal transitions once each', () => {
    const instrumentation = new FakeInstrumentation()
    const source = new RuntimeNotificationSource()
    const states = profilerStates(source)
    const coordinator = new WaterfallExperimentCoordinator(instrumentation, { runtimeNotifications: source })

    coordinator.startHuman()
    coordinator.startHuman()
    coordinator.stopHuman()
    coordinator.stopHuman()
    coordinator.startHuman()
    coordinator.forceStop()
    coordinator.startHuman()
    coordinator.dispose()
    coordinator.dispose()

    expect(states).toEqual(['enabled', 'disabled', 'enabled', 'disabled', 'enabled', 'disabled'])
  })

  it('keeps failed and pre-existing conflict transitions quiet, but reports cleanup conflict facts', () => {
    const unsupportedInstrumentation = new FakeInstrumentation()
    unsupportedInstrumentation.state = 'unsupported'
    const unsupportedSource = new RuntimeNotificationSource()
    const unsupportedStates = profilerStates(unsupportedSource)
    const unsupportedCoordinator = new WaterfallExperimentCoordinator(unsupportedInstrumentation, {
      runtimeNotifications: unsupportedSource,
    })
    expect(unsupportedCoordinator.startAgent('dsh').outcome).toBe('unsupported')
    expect(unsupportedStates).toEqual([])

    const failedInstrumentation = new FakeInstrumentation()
    failedInstrumentation.failEnable = true
    const failedSource = new RuntimeNotificationSource()
    const failedStates = profilerStates(failedSource)
    const failedCoordinator = new WaterfallExperimentCoordinator(failedInstrumentation, {
      runtimeNotifications: failedSource,
    })
    expect(failedCoordinator.startHuman()).toMatchObject({ instrumentation: 'disabled', owner: { kind: 'none' } })
    expect(failedStates).toEqual([])

    const failedStateInstrumentation = new FakeInstrumentation()
    failedStateInstrumentation.failEnable = true
    failedStateInstrumentation.failedEnableState = 'conflict'
    const failedStateSource = new RuntimeNotificationSource()
    const failedStateStates = profilerStates(failedStateSource)
    const failedStateCoordinator = new WaterfallExperimentCoordinator(failedStateInstrumentation, {
      runtimeNotifications: failedStateSource,
    })
    expect(failedStateCoordinator.startAgent('dsh').outcome).toBe('conflict')
    expect(failedStateStates).toEqual(['conflict'])

    const conflictInstrumentation = new FakeInstrumentation()
    const conflictSource = new RuntimeNotificationSource()
    const conflictStates = profilerStates(conflictSource)
    const conflictCoordinator = new WaterfallExperimentCoordinator(conflictInstrumentation, {
      createLeaseId: () => 'lease-a',
      runtimeNotifications: conflictSource,
    })
    conflictCoordinator.startAgent('dsh')
    conflictInstrumentation.state = 'conflict'
    expect(conflictCoordinator.stopAgent({ leaseId: 'lease-a' }).outcome).toBe('conflict')
    expect(conflictStates).toEqual(['enabled', 'conflict'])
  })
})
