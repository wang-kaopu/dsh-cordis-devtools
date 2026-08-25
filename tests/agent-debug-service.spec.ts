import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WaterfallExperimentStartResult, WaterfallExperimentStopResult } from '../src/shared/experiments.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import { AgentDebugService } from '../src/host/agent-debug/service.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import { AgentDebugWaitCancelledError } from '../src/host/agent-debug/observation-journal.js'
import { DevtoolsService } from '../src/host/service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent-debug/notification'(): unknown
  }
}

function observerSnapshot(names: string[]): DevtoolsSnapshot {
  return {
    generatedAt: 1,
    events: names.map((name, index) => ({ name, listenerCount: index + 1, listenerIds: [index + 1] })),
    listeners: names.map((event, index) => ({ id: index + 1, event, order: 0, prepend: false, global: false, owner: null })),
    fibers: [],
    dispatches: [],
  }
}

const profilerSnapshot: WaterfallProfilerSnapshot = {
  generatedAt: 1,
  instrumentation: 'disabled',
  experiment: { generatedAt: 1, instrumentation: 'disabled', owner: { kind: 'none' } },
  traces: [],
}

function serviceHarness(options: { maxCursors?: number } = {}) {
  const notifications = new RuntimeNotificationSource()
  let names = ['a', 'b', 'c']
  const stopAgent = vi.fn<(...args: any[]) => WaterfallExperimentStopResult>(() => ({
    outcome: 'stopped',
    status: profilerSnapshot.experiment!,
  }))
  const startAgent = vi.fn<(...args: any[]) => WaterfallExperimentStartResult>(() => ({
    outcome: 'started',
    lease: { leaseId: 'lease-1', source: 'mcp', startedAt: 1, expiresAt: 100 },
    status: { ...profilerSnapshot.experiment!, instrumentation: 'enabled', owner: { kind: 'agent', leaseId: 'lease-1', source: 'mcp', startedAt: 1, expiresAt: 100 } },
  }))
  const service = new AgentDebugService({
    ports: { snapshot: () => observerSnapshot(names), profilerSnapshot: () => profilerSnapshot, startAgent, stopAgent, runtimeNotifications: notifications },
    sessionIdleTtlMs: 10_000,
    maxCursors: options.maxCursors,
    observationCapacity: 2,
    defaultWaitTimeoutMs: 100,
    createCursorId: (() => { let i = 0; return () => `cursor-${++i}` })(),
  })
  return { service, notifications, startAgent, stopAgent, setNames: (value: string[]) => { names = value } }
}

describe('AgentDebugService', () => {
  afterEach(() => vi.useRealTimers())

  it('validates exact target/session identity and preserves stale sessions', () => {
    const { service } = serviceHarness()
    const target = service.listTargets()[0]
    const session = service.attach(target.targetId)
    expect(() => service.attach('wrong')).toThrow('unknown')
    service.replaceTarget()
    expect(() => service.snapshot({ debugSessionId: session.debugSessionId })).toThrow('stale')
    service.dispose()
  })

  it('captures a stable session-owned catalog cursor', () => {
    const harness = serviceHarness({ maxCursors: 1 })
    const session = harness.service.attach(harness.service.listTargets()[0].targetId)
    const first = harness.service.snapshot({ debugSessionId: session.debugSessionId, sections: ['events'], catalogs: { events: { limit: 1 } } })
    expect(first.events?.items).toEqual([{ name: 'a', listenerCount: 1 }])
    harness.setNames(['changed'])
    const second = harness.service.snapshot({ debugSessionId: session.debugSessionId, sections: ['events'], catalogs: { events: { cursor: first.events!.window.nextCursor! } } })
    expect(second.events?.items).toEqual([{ name: 'b', listenerCount: 2 }, { name: 'c', listenerCount: 3 }])
    harness.service.dispose()
  })

  it('reports journal gaps and expires cursor state with the session', async () => {
    vi.useFakeTimers()
    const harness = serviceHarness({ maxCursors: 1 })
    const session = harness.service.attach(harness.service.listTargets()[0].targetId)
    const first = harness.service.snapshot({ debugSessionId: session.debugSessionId, sections: ['events'], catalogs: { events: { limit: 1 } } })
    expect(first.events?.window.nextCursor).toBeTruthy()
    expect(() => harness.service.snapshot({ debugSessionId: session.debugSessionId, sections: ['events'], catalogs: { events: { limit: 1 } } })).toThrow('cursors')
    harness.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'a', mode: 'emit', argCount: 0, registeredListeners: 1 })
    harness.notifications.publish({ type: 'dispatch-observed', dispatchId: 2, event: 'b', mode: 'emit', argCount: 0, registeredListeners: 1 })
    harness.notifications.publish({ type: 'dispatch-observed', dispatchId: 3, event: 'c', mode: 'emit', argCount: 0, registeredListeners: 1 })
    const gap = await harness.service.wait({ debugSessionId: session.debugSessionId, afterSequence: 0, event: 'missing', timeoutMs: 1 })
    expect(gap.outcome).toBe('gap')
    vi.advanceTimersByTime(10_000)
    expect(() => harness.service.snapshot({ debugSessionId: session.debugSessionId })).toThrow('stale')
    expect(() => harness.service.snapshot({ debugSessionId: session.debugSessionId, sections: ['events'], catalogs: { events: { cursor: first.events!.window.nextCursor! } } })).toThrow('stale')
    harness.service.dispose()
  })

  it('records metadata-only notifications and detachment cancels waits and owned leases', async () => {
    const harness = serviceHarness()
    const session = harness.service.attach(harness.service.listTargets()[0].targetId)
    const pending = harness.service.wait({ debugSessionId: session.debugSessionId, type: 'dispatch-observed' })
    harness.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'x', mode: 'emit', argCount: 2, registeredListeners: 1 })
    const found = await pending
    expect(found.outcome).toBe('found')
    expect(JSON.stringify(found)).not.toContain('error')
    const started = harness.service.startAgent(session.debugSessionId, 'mcp')
    expect(started.outcome).toBe('started')
    const cancelled = harness.service.wait({ debugSessionId: session.debugSessionId, type: 'topology-invalidated' })
    harness.service.detach(session.debugSessionId)
    await expect(cancelled).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)
    expect(harness.stopAgent).toHaveBeenCalledWith({ leaseId: 'lease-1' })
    harness.service.dispose()
  })

  it('cleans the exact owned lease when the service is disposed', () => {
    const harness = serviceHarness()
    const session = harness.service.attach(harness.service.listTargets()[0].targetId)
    expect(harness.service.startAgent(session.debugSessionId, 'mcp').outcome).toBe('started')
    harness.service.dispose()
    expect(harness.stopAgent).toHaveBeenCalledWith({ leaseId: 'lease-1' })
  })

  it('wires one real DevtoolsService notification source into Agent Debug waits', async () => {
    const ctx = new Context()
    ctx.on('agent-debug/notification', () => undefined)
    const service = new DevtoolsService(ctx)
    const session = service.agentDebug.attach(service.agentDebug.listTargets()[0].targetId)
    const pending = service.agentDebug.wait({ debugSessionId: session.debugSessionId, type: 'dispatch-observed', event: 'agent-debug/notification' })
    ctx.emit('agent-debug/notification')
    await expect(pending).resolves.toMatchObject({ outcome: 'found', observation: { type: 'dispatch-observed', event: 'agent-debug/notification' } })
    service.dispose()
  })
})
