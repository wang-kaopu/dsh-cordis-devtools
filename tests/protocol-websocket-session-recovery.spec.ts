import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentDebugProtocol } from '../src/host/agent-debug/protocol.js'
import { AgentDebugService } from '../src/host/agent-debug/service.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import {
  PROTOCOL_WEBSOCKET_EVENT_GAP_CLOSE_CODE,
  startProtocolWebSocketServer,
  type ProtocolWebSocketHandle,
} from '../src/host/protocol-websocket.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import type { WaterfallExperimentStartResult, WaterfallExperimentStopResult } from '../src/shared/experiments.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

interface RuntimeHarness {
  notifications: RuntimeNotificationSource
  service: AgentDebugService
  protocol: AgentDebugProtocol
}

interface SocketState {
  messages: Array<Record<string, any>>
  messageWaiters: Array<(value: Record<string, any>) => void>
  close: { code: number; reason: string } | null
  closeWaiters: Array<(value: { code: number; reason: string }) => void>
}

const handles: ProtocolWebSocketHandle[] = []
const runtimes: RuntimeHarness[] = []
const sockets: WebSocket[] = []
const socketStates = new WeakMap<WebSocket, SocketState>()

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

async function start(runtime: RuntimeHarness): Promise<ProtocolWebSocketHandle> {
  const handle = await startProtocolWebSocketServer(runtime.protocol, { port: 0 })
  handles.push(handle)
  return handle
}

function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  sockets.push(socket)
  const state: SocketState = { messages: [], messageWaiters: [], close: null, closeWaiters: [] }
  socketStates.set(socket, state)
  socket.on('message', data => {
    const value = JSON.parse(data.toString()) as Record<string, any>
    const waiter = state.messageWaiters.shift()
    if (waiter === undefined) state.messages.push(value)
    else waiter(value)
  })
  socket.on('close', (code, reason) => {
    const value = { code, reason: reason.toString() }
    state.close = value
    for (const waiter of state.closeWaiters.splice(0)) waiter(value)
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 2_000)
    socket.once('open', () => { clearTimeout(timer); resolve(socket) })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
}

function nextMessage(socket: WebSocket): Promise<Record<string, any>> {
  const state = socketStates.get(socket)
  if (state === undefined) return Promise.reject(new Error('missing socket state'))
  if (state.messages.length > 0) return Promise.resolve(state.messages.shift()!)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timed out')), 2_000)
    state.messageWaiters.push(value => { clearTimeout(timer); resolve(value) })
  })
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  const state = socketStates.get(socket)
  if (state === undefined) return Promise.reject(new Error('missing socket state'))
  if (state.close !== null) return Promise.resolve(state.close)
  return new Promise(resolve => state.closeWaiters.push(resolve))
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

describe('protocol WebSocket session and recovery semantics', () => {
  it('rejects a second Target.attachToTarget on a target-scoped connection', async () => {
    const runtime = createRuntime()
    const handle = await start(runtime)
    const target = runtime.service.listTargets()[0]
    const socket = await connect(handle.webSocketUrl(target.targetId))
    const attached = await nextMessage(socket)
    const sessionId = attached.sessionId as string

    socket.send(JSON.stringify({ id: 1, method: 'Target.attachToTarget', params: { targetId: target.targetId } }))
    expect(await nextMessage(socket)).toMatchObject({
      id: 1,
      error: { code: 'capability_not_supported' },
    })

    socket.send(JSON.stringify({ id: 2, method: 'Cordis.getSnapshot', params: { sections: ['summary'] }, sessionId }))
    expect(await nextMessage(socket)).toMatchObject({ id: 2, result: { session: { debugSessionId: sessionId } }, sessionId })
  })

  it('closes explicitly when the live event cursor falls behind the retained journal', async () => {
    const runtime = createRuntime(2)
    const handle = await start(runtime)
    const socket = await connect(handle.webSocketUrl(runtime.service.listTargets()[0].targetId))
    const attached = await nextMessage(socket)
    const sessionId = attached.sessionId as string

    socket.send(JSON.stringify({ id: 1, method: 'Cordis.enable', sessionId }))
    expect(await nextMessage(socket)).toMatchObject({ id: 1, result: { enabled: true }, sessionId })

    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 1, event: 'one', mode: 'emit', argCount: 0, registeredListeners: 0 })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 2, event: 'two', mode: 'emit', argCount: 0, registeredListeners: 0 })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 3, event: 'three', mode: 'emit', argCount: 0, registeredListeners: 0 })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 4, event: 'four', mode: 'emit', argCount: 0, registeredListeners: 0 })

    expect(await nextClose(socket)).toEqual({
      code: PROTOCOL_WEBSOCKET_EVENT_GAP_CLOSE_CODE,
      reason: 'protocol event journal gap',
    })
  })
})
