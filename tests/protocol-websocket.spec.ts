import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentDebugProtocol } from '../src/host/agent-debug/protocol.js'
import { AgentDebugService } from '../src/host/agent-debug/service.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import { startProtocolWebSocketServer, type ProtocolWebSocketHandle } from '../src/host/protocol-websocket.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import type { WaterfallExperimentStartResult, WaterfallExperimentStopResult } from '../src/shared/experiments.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

interface RuntimeHarness {
  notifications: RuntimeNotificationSource
  service: AgentDebugService
  protocol: AgentDebugProtocol
}

const handles: ProtocolWebSocketHandle[] = []
const runtimes: RuntimeHarness[] = []
const sockets: WebSocket[] = []
interface MessageState {
  messages: Array<Record<string, any>>
  waiters: Array<(value: Record<string, any>) => void>
  close?: { code: number; reason: string }
}

const messageStates = new WeakMap<WebSocket, MessageState>()

function createRuntime(capacity = 8): RuntimeHarness {
  const notifications = new RuntimeNotificationSource()
  const snapshot: DevtoolsSnapshot = { generatedAt: 1, events: [], listeners: [], fibers: [], dispatches: [] }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 1,
    instrumentation: 'disabled',
    experiment: { generatedAt: 1, instrumentation: 'disabled', owner: { kind: 'none' } },
    traces: [],
  }
  const service = new AgentDebugService({
    ports: {
      snapshot: () => snapshot,
      profilerSnapshot: () => profiler,
      startAgent: (): WaterfallExperimentStartResult => ({ outcome: 'unsupported', lease: null, status: profiler.experiment! }),
      stopAgent: (): WaterfallExperimentStopResult => ({ outcome: 'not-active', status: profiler.experiment! }),
      runtimeNotifications: notifications,
    },
    observationCapacity: capacity,
  })
  const diagnostics = new RuntimeDiagnosticsQuery({
    snapshot: () => snapshot,
    profilerSnapshot: () => profiler,
    waterfallExperimentStatus: () => profiler.experiment!,
  })
  const runtime = { notifications, service, protocol: new AgentDebugProtocol(service, diagnostics) }
  runtimes.push(runtime)
  return runtime
}

async function start(runtime: RuntimeHarness, options: Parameters<typeof startProtocolWebSocketServer>[1] = {}): Promise<ProtocolWebSocketHandle> {
  const handle = await startProtocolWebSocketServer(runtime.protocol, { port: 0, ...options })
  handles.push(handle)
  return handle
}

function connect(url: string, token?: string): Promise<WebSocket> {
  const socket = new WebSocket(url, token === undefined ? undefined : { headers: { Authorization: `Bearer ${token}` } })
  sockets.push(socket)
  const state: MessageState = { messages: [], waiters: [] }
  messageStates.set(socket, state)
  socket.on('message', data => {
    const value = JSON.parse(data.toString()) as Record<string, any>
    const waiter = state.waiters.shift()
    if (waiter === undefined) state.messages.push(value)
    else waiter(value)
  })
  socket.on('close', (code, reason) => { state.close = { code, reason: reason.toString() } })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 2_000)
    socket.once('open', () => { clearTimeout(timer); resolve(socket) })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
}

function message(socket: WebSocket): Promise<Record<string, any>> {
  const state = messageStates.get(socket)
  if (state === undefined) return Promise.reject(new Error('missing WebSocket message state'))
  if (state.messages.length > 0) return Promise.resolve(state.messages.shift()!)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket message timed out${state.close === undefined ? '' : ` (closed ${state.close.code}: ${state.close.reason})`}`)), 2_000)
    state.waiters.push(value => { clearTimeout(timer); resolve(value) })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
}

function noMessage(socket: WebSocket, timeoutMs = 100): Promise<void> {
  const state = messageStates.get(socket)
  if (state === undefined) return Promise.reject(new Error('missing WebSocket message state'))
  if (state.messages.length > 0) return Promise.reject(new Error('unexpected WebSocket message'))
  return new Promise((resolve, reject) => {
    const waiter = () => { clearTimeout(timer); reject(new Error('unexpected WebSocket message')) }
    const timer = setTimeout(() => {
      const index = state.waiters.indexOf(waiter)
      if (index >= 0) state.waiters.splice(index, 1)
      resolve()
    }, timeoutMs)
    state.waiters.push(waiter)
  })
}

function close(socket: WebSocket): Promise<{ code: number; reason: string }> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve({ code: 1000, reason: '' })
  return new Promise(resolve => socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
  }
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
  for (const runtime of runtimes.splice(0)) {
    runtime.service.dispose()
    runtime.notifications.dispose()
  }
})

describe('protocol WebSocket adapter', () => {
  it('authenticates upgrades, automatically attaches, routes commands, and detaches on close', async () => {
    const runtime = createRuntime()
    const token = 'websocket-secret'
    const handle = await start(runtime, { token })
    const targetId = runtime.service.listTargets()[0].targetId

    await expect(connect(handle.webSocketUrl(targetId))).rejects.toThrow()
    const socket = await connect(handle.webSocketUrl(targetId), token)
    const attached = await message(socket)
    expect(attached).toMatchObject({
      method: 'Target.attachedToTarget',
      params: { target: { targetId }, session: { targetId } },
      sessionId: expect.any(String),
    })
    expect(JSON.stringify(attached)).not.toContain(token)
    const sessionId = attached.sessionId as string

    socket.send(JSON.stringify({ id: 1, method: 'Schema.getDomains' }))
    expect(await message(socket)).toMatchObject({ id: 1, result: { name: 'dsh-devtools-for-agents', version: 1 } })
    socket.send(JSON.stringify({ id: 2, method: 'Cordis.getSnapshot', params: { sections: ['summary'] }, sessionId }))
    expect(await message(socket)).toMatchObject({ id: 2, result: { eventCursor: 0, session: { debugSessionId: sessionId } }, sessionId })

    socket.close()
    await close(socket)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(runtime.protocol.send({ id: 3, method: 'Cordis.getSnapshot', sessionId })).toMatchObject({ id: 3, error: { code: 'session_stale' }, sessionId })
  })

  it('returns stable errors and only pushes explicitly enabled Cordis events', async () => {
    const runtime = createRuntime()
    const handle = await start(runtime)
    const socket = await connect(handle.webSocketUrl(runtime.service.listTargets()[0].targetId))
    const sessionId = (await message(socket)).sessionId as string

    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'disabled', mode: 'emit', argCount: 0, registeredListeners: 0 })
    await noMessage(socket)

    socket.send('{not-json')
    expect(await message(socket)).toMatchObject({ id: 0, error: { code: 'invalid_request' } })
    socket.send(JSON.stringify({ id: 4, method: 'unknown.method', sessionId }))
    expect(await message(socket)).toMatchObject({ id: 4, error: { code: 'unknown_method' }, sessionId })

    socket.send(JSON.stringify({ id: 5, method: 'Cordis.enable', sessionId }))
    expect(await message(socket)).toMatchObject({ id: 5, result: { enabled: true, domain: 'Cordis' }, sessionId })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 2, event: 'enabled', mode: 'emit', argCount: 0, registeredListeners: 0 })
    expect(await message(socket)).toMatchObject({ method: 'Cordis.dispatchObserved', sessionId, params: { sequence: 2, event: 'enabled' } })

    socket.send(JSON.stringify({ id: 6, method: 'Cordis.disable', sessionId }))
    expect(await message(socket)).toMatchObject({ id: 6, result: { enabled: false, domain: 'Cordis' }, sessionId })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 3, event: 'disabled-again', mode: 'emit', argCount: 0, registeredListeners: 0 })
    await noMessage(socket)
  })

  it('routes bounded replay and reports a journal gap without inventing continuity', async () => {
    const runtime = createRuntime(2)
    const handle = await start(runtime)
    const socket = await connect(handle.webSocketUrl(runtime.service.listTargets()[0].targetId))
    const sessionId = (await message(socket)).sessionId as string

    socket.send(JSON.stringify({ id: 6, method: 'Cordis.enable', sessionId }))
    expect(await message(socket)).toMatchObject({ id: 6, result: { enabled: true, domain: 'Cordis' }, sessionId })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'one', mode: 'emit', argCount: 0, registeredListeners: 0 })
    expect(await message(socket)).toMatchObject({ method: 'Cordis.dispatchObserved', params: { sequence: 1, event: 'one' } })
    socket.send(JSON.stringify({ id: 7, method: 'Cordis.readEvents', params: { afterSequence: 0, method: 'Cordis.dispatchObserved' }, sessionId }))
    expect(await message(socket)).toMatchObject({ id: 7, result: { outcome: 'ok', events: [{ params: { sequence: 1, event: 'one' } }] }, sessionId })

    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 2, event: 'two', mode: 'emit', argCount: 0, registeredListeners: 0 })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 3, event: 'three', mode: 'emit', argCount: 0, registeredListeners: 0 })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 4, event: 'four', mode: 'emit', argCount: 0, registeredListeners: 0 })
    await message(socket)
    await message(socket)
    await message(socket)
    socket.send(JSON.stringify({ id: 8, method: 'Cordis.readEvents', params: { afterSequence: 0 }, sessionId }))
    expect(await message(socket)).toMatchObject({ id: 8, result: { outcome: 'gap', events: [], window: { gap: true } }, sessionId })
  })

  it('closes a connection when its exact target incarnation becomes stale', async () => {
    const runtime = createRuntime()
    const handle = await start(runtime)
    const socket = await connect(handle.webSocketUrl(runtime.service.listTargets()[0].targetId))
    await message(socket)

    runtime.service.replaceTarget()
    expect(await close(socket)).toMatchObject({ code: 4002, reason: 'attached target is stale' })
  })
})
