import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDebugProtocol } from '../src/host/agent-debug/protocol.js'
import { AgentDebugService } from '../src/host/agent-debug/service.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import { AgentDebugWaitCancelledError } from '../src/host/agent-debug/observation-journal.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import type { WaterfallExperimentStartResult, WaterfallExperimentStopResult } from '../src/shared/experiments.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { DevtoolsProtocolTargetAttachedToTargetEvent } from '../src/shared/devtools-protocol.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

function observerSnapshot(): DevtoolsSnapshot {
  return { generatedAt: 1, events: [], listeners: [], fibers: [], dispatches: [] }
}

function profilerSnapshot(): WaterfallProfilerSnapshot {
  return { generatedAt: 1, instrumentation: 'disabled', experiment: { generatedAt: 1, instrumentation: 'disabled', owner: { kind: 'none' } }, traces: [] }
}

function harness(options: { snapshot?: () => DevtoolsSnapshot; capacity?: number } = {}) {
  const notifications = new RuntimeNotificationSource()
  const startAgent = vi.fn<() => WaterfallExperimentStartResult>(() => ({ outcome: 'started', lease: { leaseId: 'lease-1', source: 'mcp', startedAt: 1, expiresAt: 101 }, status: { generatedAt: 1, instrumentation: 'enabled', owner: { kind: 'none' } } }))
  const stopAgent = vi.fn<() => WaterfallExperimentStopResult>(() => ({ outcome: 'stopped', status: profilerSnapshot().experiment! }))
  const service = new AgentDebugService({
    ports: {
      snapshot: options.snapshot ?? observerSnapshot,
      profilerSnapshot,
      startAgent,
      stopAgent,
      runtimeNotifications: notifications,
    },
    observationCapacity: options.capacity ?? 2,
    defaultWaitTimeoutMs: 10,
  })
  const diagnostics = new RuntimeDiagnosticsQuery({ snapshot: options.snapshot ?? observerSnapshot, profilerSnapshot, waterfallExperimentStatus: () => profilerSnapshot().experiment! })
  return { notifications, service, protocol: new AgentDebugProtocol(service, diagnostics), startAgent, stopAgent }
}

describe('DSH DevTools protocol core', () => {
  afterEach(() => vi.useRealTimers())

  it('exposes one discoverable schema and routes target/session commands', () => {
    const { protocol, service } = harness()
    const schema = protocol.send({ id: 17, method: 'Schema.getDomains' })
    expect(schema).toMatchObject({ id: 17, result: { name: 'dsh-devtools-for-agents', version: 1 } })
    expect(protocol.getProtocol().domains.map(domain => domain.name)).toEqual(['Schema', 'Target', 'Cordis', 'Fiber', 'Profiler'])
    expect(protocol.getProtocol().domains.flatMap(domain => domain.commands.map(command => command.name))).toContain('Cordis.getSnapshot')
    expect(protocol.getProtocol().domains.find(domain => domain.name === 'Target')?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Target.attachedToTarget', sessionRequired: false, params: expect.objectContaining({ type: 'object', required: ['target', 'session'] }) }),
    ]))
    expect(protocol.getProtocol().domains.find(domain => domain.name === 'Cordis')?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Cordis.readEvents', sessionRequired: true }),
    ]))

    const target = protocol.send({ id: 18, method: 'Target.getTargets' })
    expect(target).toMatchObject({ id: 18, result: { targets: [{ type: 'cordis-runtime', targetEpoch: 1 }] } })
    const targetId = service.listTargets()[0].targetId
    const attached = protocol.send({ id: 19, method: 'Target.attachToTarget', params: { targetId } })
    expect(attached).toMatchObject({ id: 19, result: { targetId, targetEpoch: 1 } })
    const attachedSession = (attached as { result: DevtoolsProtocolTargetAttachedToTargetEvent['params']['session'] }).result
    const sessionId = attachedSession.debugSessionId
    const attachedEvent: DevtoolsProtocolTargetAttachedToTargetEvent = { method: 'Target.attachedToTarget', sessionId, params: { target: service.listTargets()[0], session: attachedSession } }
    expect(attachedEvent).toMatchObject({ method: 'Target.attachedToTarget', sessionId, params: { target: { targetId }, session: { debugSessionId: sessionId } } })
    expect(protocol.send({ id: 20, method: 'Cordis.getSnapshot', sessionId })).toMatchObject({ id: 20, result: { eventCursor: 0, session: { debugSessionId: sessionId } }, sessionId })
    expect(protocol.send({ id: 21, method: 'Cordis.readEvents', sessionId, params: { afterSequence: 0 } })).toMatchObject({ id: 21, result: { outcome: 'ok', events: [], session: { debugSessionId: sessionId } }, sessionId })
    expect(protocol.send({ id: 22, method: 'Cordis.readEvents', params: { afterSequence: 0 } })).toMatchObject({ id: 22, error: { code: 'invalid_params' } })
    expect(protocol.send({ id: 23, method: 'unknown.method', sessionId })).toMatchObject({ id: 23, error: { code: 'unknown_method' }, sessionId })
    service.dispose()
  })

  it('uses the pre-snapshot barrier and preserves sequence-aware event reads', () => {
    let snapshotCalls = 0
    const harnessRef: { value?: ReturnType<typeof harness> } = {}
    const currentSnapshot = () => {
      snapshotCalls += 1
      if (snapshotCalls === 1) harnessRef.value?.notifications.publish({ type: 'dispatch-observed', dispatchId: 7, event: 'runtime.ready', mode: 'emit', argCount: 0, registeredListeners: 1 })
      return observerSnapshot()
    }
    harnessRef.value = harness({ snapshot: currentSnapshot })
    const { protocol, service } = harnessRef.value
    const sessionId = protocol.attach(service.listTargets()[0].targetId).debugSessionId
    const snapshot = service.debugSnapshot({ debugSessionId: sessionId, sections: ['summary'] })
    expect(snapshot.eventCursor).toBe(0)
    const events = protocol.readEvents({ debugSessionId: sessionId, afterSequence: snapshot.eventCursor })
    expect(events.events).toMatchObject([{ method: 'Cordis.dispatchObserved', params: { sequence: 1, event: 'runtime.ready' } }])
    expect(protocol.readEvents({ debugSessionId: sessionId, afterSequence: 1 }).events).toEqual([])
    service.dispose()
  })

  it('supports domain subscriptions, found/timeout/gap waits, and stale rejection', async () => {
    const h = harness()
    const sessionId = h.protocol.attach(h.service.listTargets()[0].targetId).debugSessionId
    h.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'before', mode: 'emit', argCount: 0, registeredListeners: 1 })
    await expect(h.protocol.waitForEvent({ debugSessionId: sessionId, afterSequence: 0, method: 'Cordis.dispatchObserved' })).resolves.toMatchObject({ outcome: 'found', event: { method: 'Cordis.dispatchObserved' } })
    expect(h.protocol.send({ id: 1, method: 'Cordis.disable', sessionId })).toMatchObject({ id: 1, result: { enabled: false } })
    h.notifications.publish({ type: 'dispatch-observed', dispatchId: 2, event: 'disabled', mode: 'emit', argCount: 0, registeredListeners: 1 })
    expect(h.protocol.readEvents({ debugSessionId: sessionId, afterSequence: 1 }).events).toEqual([])
    expect(await h.protocol.waitForEvent({ debugSessionId: sessionId, afterSequence: 1, method: 'Cordis.dispatchObserved', timeoutMs: 0 })).toMatchObject({ outcome: 'timeout' })
    h.protocol.send({ id: 2, method: 'Cordis.enable', sessionId })
    const abort = new AbortController()
    const pending = h.protocol.waitForEvent({ debugSessionId: sessionId, afterSequence: 2, method: 'Cordis.dispatchObserved', timeoutMs: 100 }, abort.signal)
    abort.abort()
    await expect(pending).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)

    const g = harness({ capacity: 2 })
    const gapSession = g.protocol.attach(g.service.listTargets()[0].targetId).debugSessionId
    for (const dispatchId of [1, 2, 3]) g.notifications.publish({ type: 'dispatch-observed', dispatchId, event: `event-${dispatchId}`, mode: 'emit', argCount: 0, registeredListeners: 1 })
    expect(g.protocol.readEvents({ debugSessionId: gapSession, afterSequence: 0 })).toMatchObject({ outcome: 'gap', window: { oldestSequence: 2, newestSequence: 3, gap: true }, events: [] })
    g.service.dispose()

    h.service.replaceTarget()
    expect(h.protocol.send({ id: 5, method: 'Cordis.readEvents', sessionId, params: { afterSequence: 0 } })).toMatchObject({ id: 5, error: { code: 'session_stale' }, sessionId })
    h.service.dispose()
  })

  it('keeps profiler event subscription separate from mutation authority', () => {
    const h = harness()
    const sessionId = h.protocol.attach(h.service.listTargets()[0].targetId).debugSessionId
    expect(h.protocol.send({ id: 1, method: 'Profiler.enableEvents', sessionId })).toMatchObject({ id: 1, result: { enabled: true } })
    expect(h.protocol.send({ id: 2, method: 'Profiler.startExperiment', sessionId })).toMatchObject({ id: 2, error: { code: 'not_authorized' } })
    expect(h.protocol.send({ id: 3, method: 'Profiler.startExperiment', sessionId }, { allowExperimentMutation: true })).toMatchObject({ id: 3, result: { outcome: 'started', lease: { leaseId: 'lease-1' } }, sessionId })
    expect(h.startAgent).toHaveBeenCalledWith('mcp', {})
    expect(h.protocol.send({ id: 4, method: 'Profiler.stopExperiment', sessionId, params: { leaseId: 'lease-1' } }, { allowExperimentMutation: true })).toMatchObject({ id: 4, result: { outcome: 'stopped' }, sessionId })
    expect(h.stopAgent).toHaveBeenCalledWith({ leaseId: 'lease-1' })
    h.service.dispose()
  })
})
