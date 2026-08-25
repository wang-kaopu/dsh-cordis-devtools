import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentDebugSessionRegistry,
  AgentDebugTargetRegistry,
} from '../src/host/agent-debug/target-session.js'
import {
  AgentDebugObservationJournal,
  AgentDebugWaitCancelledError,
} from '../src/host/agent-debug/observation-journal.js'

const metadata = { title: 'test', pluginVersion: null, cordisVersion: null }

function dispatch(event = 'a') {
  return { type: 'dispatch-observed' as const, observedAt: Date.now(), dispatchId: 1, event, mode: 'emit', argCount: 0, registeredListeners: 1 }
}

describe('Agent Debug target and session core', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps target incarnations opaque and marks sessions stale on replacement/disposal', () => {
    const targets = new AgentDebugTargetRegistry({ createId: (() => { let i = 0; return () => `id-${++i}` })() })
    const sessions = new AgentDebugSessionRegistry({ maxSessions: 4, sessionIdleTtlMs: 1000, maxCursors: 2, createId: (() => { let i = 10; return () => `id-${++i}` })() })
    const first = targets.activate({ metadata })
    const session = sessions.attach(first)
    const second = targets.replace({ metadata })
    sessions.markTargetReplaced(first)
    expect(first.targetId).not.toBe(second.targetId)
    expect(sessions.get(session.debugSessionId)?.staleReason).toBe('target-replaced')
    const session2 = sessions.attach(second)
    targets.dispose()
    sessions.markTargetDisposed(second)
    expect(sessions.get(session2.debugSessionId)?.staleReason).toBe('target-disposed')
  })

  it('notifies target disposal once and removes lifecycle listeners on dispose', () => {
    const targets = new AgentDebugTargetRegistry({ createId: (() => { let i = 0; return () => `target-${++i}` })() })
    const events: string[] = []
    targets.onLifecycle((event) => events.push(event.kind))
    targets.activate({ metadata })
    targets.dispose()
    targets.dispose()
    expect(events).toEqual(['disposed'])
    expect(() => targets.activate({ metadata })).toThrow('target registry is disposed')
  })

  it('expires idle sessions, bounds capacity, and cancels the per-session signal', () => {
    const sessions = new AgentDebugSessionRegistry({ maxSessions: 1, sessionIdleTtlMs: 100, maxCursors: 1 })
    const first = sessions.attach({ targetId: 'target', targetEpoch: 1 })
    const second = sessions.attach({ targetId: 'target', targetEpoch: 1 })
    expect(sessions.snapshots()).toHaveLength(1)
    expect(sessions.get(first.debugSessionId)).toBeNull()
    expect(second.debugSessionId).not.toBe(first.debugSessionId)

    vi.useFakeTimers()
    const timed = sessions.attach({ targetId: 'target', targetEpoch: 1 })
    const signal = sessions.getAbortSignal(timed.debugSessionId)
    expect(signal?.aborted).toBe(false)
    vi.advanceTimersByTime(100)
    expect(sessions.get(timed.debugSessionId)?.status).toBe('expired')
    expect(signal?.aborted).toBe(true)
    const third = sessions.attach({ targetId: 'target', targetEpoch: 1 })
    expect(sessions.snapshots()).toHaveLength(1)
    expect(third.debugSessionId).not.toBe(timed.debugSessionId)
  })
})

describe('Agent Debug observation journal', () => {
  afterEach(() => vi.useRealTimers())

  it('assigns monotonic sequences, bounds retained state, and reports gaps', () => {
    const journal = new AgentDebugObservationJournal({ capacity: 2, maxWaiters: 2 })
    expect(journal.append(dispatch()).sequence).toBe(1)
    expect(journal.append(dispatch()).sequence).toBe(2)
    expect(journal.append(dispatch()).sequence).toBe(3)
    expect(journal.window(0)).toMatchObject({ oldestSequence: 2, newestSequence: 3, retained: 2, truncated: true, gap: true })
    expect(journal.read(1)).toHaveLength(2)
    expect(JSON.stringify(journal.read())).not.toContain('error')
  })

  it('uses exact type/event matching and returns found, timeout, and gap outcomes', async () => {
    vi.useFakeTimers()
    const journal = new AgentDebugObservationJournal({ capacity: 3, maxWaiters: 2, defaultTimeoutMs: 20 })
    journal.append(dispatch('wanted'))
    expect((await journal.wait({ afterSequence: 0, type: 'dispatch-observed', event: 'wanted' })).outcome).toBe('found')
    const timeout = journal.wait({ afterSequence: 1, event: 'missing', timeoutMs: 10 })
    vi.advanceTimersByTime(10)
    expect((await timeout).outcome).toBe('timeout')
    journal.append(dispatch('other'))
    journal.append(dispatch('third'))
    journal.append(dispatch('fourth'))
    expect((await journal.wait({ afterSequence: 0, event: 'never' })).outcome).toBe('gap')
    expect((await journal.wait({ afterSequence: 0, event: 'other' })).outcome).toBe('gap')
  })

  it('resolves waiters on append, abort, custom cancellation, and dispose', async () => {
    vi.useFakeTimers()
    const journal = new AgentDebugObservationJournal({ capacity: 4, maxWaiters: 1, defaultTimeoutMs: 100 })
    const controller = new AbortController()
    const pending = journal.wait({ type: 'dispatch-observed', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)

    let cancel!: () => void
    const pendingCustom = journal.wait({ onCancel: (callback) => { cancel = callback; return () => undefined } })
    cancel()
    await expect(pendingCustom).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)

    const pendingDispose = journal.wait({ type: 'dispatch-observed' })
    journal.dispose()
    await expect(pendingDispose).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)
    expect(journal.sizes.waiters).toBe(0)
  })

  it('cancels a journal wait through a session detach signal', async () => {
    const sessions = new AgentDebugSessionRegistry({ maxSessions: 2, sessionIdleTtlMs: 1000, maxCursors: 1 })
    const session = sessions.attach({ targetId: 'target', targetEpoch: 1 })
    const journal = new AgentDebugObservationJournal({ capacity: 2, maxWaiters: 1, defaultTimeoutMs: 1000 })
    const pending = journal.wait({ signal: sessions.getAbortSignal(session.debugSessionId) ?? undefined })
    sessions.detach(session.debugSessionId)
    await expect(pending).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)
    journal.dispose()
    sessions.dispose()
  })

  it('enforces waiter capacity', async () => {
    const journal = new AgentDebugObservationJournal({ capacity: 2, maxWaiters: 1, defaultTimeoutMs: 100 })
    const first = journal.wait()
    await expect(journal.wait()).rejects.toThrow('maximum Agent Debug waiters')
    journal.dispose()
    await expect(first).rejects.toBeInstanceOf(AgentDebugWaitCancelledError)
  })
})
