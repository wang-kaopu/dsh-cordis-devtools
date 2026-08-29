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

interface JsonResponse {
  status: number
  body: unknown
  text: string
}

const handles: ProtocolWebSocketHandle[] = []
const runtimes: RuntimeHarness[] = []

/** Creates the real Host-side composition used by discovery integration tests. */
function createRuntime(): RuntimeHarness {
  const notifications = new RuntimeNotificationSource()
  const observer: DevtoolsSnapshot = {
    generatedAt: 10,
    events: [{ name: 'runtime.ready', listenerCount: 1, listenerIds: [7] }],
    listeners: [{ id: 7, event: 'runtime.ready', order: 0, prepend: false, global: false, owner: null }],
    fibers: [],
    dispatches: [],
  }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 11,
    instrumentation: 'disabled',
    experiment: { generatedAt: 11, instrumentation: 'disabled', owner: { kind: 'none' } },
    traces: [],
  }
  const startAgent = (): WaterfallExperimentStartResult => ({ outcome: 'unsupported', lease: null, status: profiler.experiment! })
  const stopAgent = (): WaterfallExperimentStopResult => ({ outcome: 'not-active', status: profiler.experiment! })
  const service = new AgentDebugService({
    ports: {
      snapshot: () => structuredClone(observer),
      profilerSnapshot: () => structuredClone(profiler),
      startAgent,
      stopAgent,
      runtimeNotifications: notifications,
    },
  })
  const diagnostics = new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
    waterfallExperimentStatus: () => structuredClone(profiler.experiment!),
  })
  const runtime = { notifications, service, protocol: new AgentDebugProtocol(service, diagnostics) }
  runtimes.push(runtime)
  return runtime
}

/** Starts an ephemeral real loopback server and registers it for teardown. */
async function start(runtime: RuntimeHarness, token?: string): Promise<ProtocolWebSocketHandle> {
  const handle = await startProtocolWebSocketServer(runtime.protocol, { port: 0, ...(token === undefined ? {} : { token }) })
  handles.push(handle)
  return handle
}

/** Fetches and decodes one JSON discovery response without hiding its wire text. */
async function getJson(url: string, headers?: Record<string, string>): Promise<JsonResponse> {
  const response = await fetch(url, { headers })
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text), text }
}

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
  for (const runtime of runtimes.splice(0)) {
    runtime.service.dispose()
    runtime.notifications.dispose()
  }
})

describe('protocol WebSocket discovery', () => {
  it('uses an ephemeral loopback listener and exposes only DSH discovery fields', async () => {
    const runtime = createRuntime()
    const handle = await start(runtime)
    expect(handle.host).toBe('127.0.0.1')
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const version = await getJson(`${handle.url}/json/version`)
    expect(version.status).toBe(200)
    expect(version.body).toEqual({ Browser: expect.stringMatching(/^dsh-cordis-devtools\/\d+\.\d+\.\d+$/), 'Protocol-Version': '1.0' })
    expect(version.text).not.toContain('Chrome')
    expect(version.text).not.toContain('Chromium')

    const listed = await getJson(`${handle.url}/json/list`)
    expect(listed.status).toBe(200)
    expect(Array.isArray(listed.body)).toBe(true)
    const target = (listed.body as Array<Record<string, unknown>>)[0]
    expect(Object.keys(target).sort()).toEqual([
      'capabilities',
      'description',
      'id',
      'status',
      'targetEpoch',
      'title',
      'type',
      'webSocketDebuggerUrl',
    ])
    expect(target).toMatchObject({
      id: runtime.service.listTargets()[0].targetId,
      type: 'cordis-runtime',
      title: 'Cordis Runtime',
      description: 'Live DSH/Cordis runtime',
      status: 'active',
      targetEpoch: 1,
    })
    expect(target).not.toHaveProperty('url')
    expect(target).not.toHaveProperty('faviconUrl')
    expect(target).not.toHaveProperty('devtoolsFrontendUrl')
    expect(target.webSocketDebuggerUrl).toBe(handle.webSocketUrl(String(target.id)))

    const protocol = await getJson(`${handle.url}/json/protocol`)
    expect(protocol.status).toBe(200)
    expect(protocol.body).toMatchObject({ name: 'dsh-devtools-for-agents', version: 1, wire: 'json-command' })
    expect((protocol.body as { domains: Array<{ name: string }> }).domains.map(domain => domain.name)).toEqual(['Schema', 'Target', 'Cordis', 'Fiber', 'Profiler'])
    const methods = (protocol.body as { domains: Array<{ commands: Array<{ name: string }> }> }).domains.flatMap(domain => domain.commands.map(command => command.name))
    expect(methods).toEqual(expect.arrayContaining(['Schema.getDomains', 'Target.getTargets', 'Cordis.getSnapshot', 'Cordis.readEvents']))
  })

  it('requires the configured bearer token for discovery without reflecting it in payloads', async () => {
    const runtime = createRuntime()
    const token = 'discovery-secret-that-must-not-escape'
    const handle = await start(runtime, token)

    const unauthorized = await getJson(`${handle.url}/json/version`)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.body).toEqual({ error: 'unauthorized' })
    expect(unauthorized.text).not.toContain(token)

    const headers = { Authorization: `Bearer ${token}` }
    const responses = await Promise.all([
      getJson(`${handle.url}/json/version`, headers),
      getJson(`${handle.url}/json/list`, headers),
      getJson(`${handle.url}/json/protocol`, headers),
    ])
    expect(responses.every(response => response.status === 200)).toBe(true)
    expect(responses.map(response => response.text).join('\n')).not.toContain(token)
  })

  it('rejects non-GET discovery requests and unknown routes with stable HTTP statuses', async () => {
    const runtime = createRuntime()
    const handle = await start(runtime)
    const post = await fetch(`${handle.url}/json/version`, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET')
    expect(await post.json()).toEqual({ error: 'method not allowed' })

    const unknown = await getJson(`${handle.url}/not-a-discovery-route`)
    expect(unknown.status).toBe(404)
    expect(unknown.body).toEqual({ error: 'not found' })
  })
})
