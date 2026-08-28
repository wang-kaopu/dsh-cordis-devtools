import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentDebugProtocol } from '../src/host/agent-debug/protocol.js'
import { AgentDebugService } from '../src/host/agent-debug/service.js'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import { RuntimeNotificationSource } from '../src/host/runtime-notifications.js'
import { startEmbeddedMcpServer, type EmbeddedMcpHandle } from '../src/host/mcp.js'
import type { WaterfallExperimentStartResult, WaterfallExperimentStopResult } from '../src/shared/experiments.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

const handles: EmbeddedMcpHandle[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map(client => client.close()))
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
})

function createRuntime() {
  const notifications = new RuntimeNotificationSource()
  const snapshot = (): DevtoolsSnapshot => ({ generatedAt: 1, events: [], listeners: [], fibers: [], dispatches: [] })
  const profilerSnapshot = (): WaterfallProfilerSnapshot => ({ generatedAt: 1, instrumentation: 'disabled', experiment: { generatedAt: 1, instrumentation: 'disabled', owner: { kind: 'none' } }, traces: [] })
  const service = new AgentDebugService({
    ports: {
      snapshot,
      profilerSnapshot,
      startAgent: (): WaterfallExperimentStartResult => ({ outcome: 'unsupported', lease: null, status: profilerSnapshot().experiment! }),
      stopAgent: (): WaterfallExperimentStopResult => ({ outcome: 'not-active', status: profilerSnapshot().experiment! }),
      runtimeNotifications: notifications,
    },
  })
  const diagnostics = new RuntimeDiagnosticsQuery({ snapshot, profilerSnapshot, waterfallExperimentStatus: () => profilerSnapshot().experiment! })
  return { notifications, service, protocol: new AgentDebugProtocol(service, diagnostics), diagnostics }
}

async function connect(handle: EmbeddedMcpHandle): Promise<Client> {
  const client = new Client({ name: 'protocol-mcp-test', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)))
  return client
}

describe('MCP protocol primitives', () => {
  it('supports discover, attach, generic send, read events, and detach', async () => {
    const runtime = createRuntime()
    const handle = await startEmbeddedMcpServer(runtime.diagnostics, { port: 0, protocol: runtime.protocol })
    handles.push(handle)
    const client = await connect(handle)
    const names = (await client.listTools()).tools.map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'cordis_devtools_get_protocol', 'cordis_devtools_list_targets', 'cordis_devtools_attach',
      'cordis_devtools_send', 'cordis_devtools_read_events', 'cordis_devtools_wait_for_event', 'cordis_devtools_detach',
    ]))
    expect((await client.callTool({ name: 'cordis_devtools_get_protocol', arguments: {} })).structuredContent).toMatchObject({ name: 'dsh-devtools-for-agents', version: 1 })
    const targets = await client.callTool({ name: 'cordis_devtools_list_targets', arguments: {} })
    const targetId = (targets.structuredContent as { targets: [{ targetId: string }] }).targets[0].targetId
    const attached = await client.callTool({ name: 'cordis_devtools_attach', arguments: { targetId } })
    const sessionId = (attached.structuredContent as { debugSessionId: string }).debugSessionId
    const snapshot = await client.callTool({ name: 'cordis_devtools_send', arguments: { id: 42, sessionId, method: 'Cordis.getSnapshot', params: { sections: ['summary'] } } })
    expect(snapshot.structuredContent).toMatchObject({ id: 42, result: { eventCursor: 0, session: { debugSessionId: sessionId } }, sessionId })
    runtime.notifications.publish({ type: 'dispatch-observed', dispatchId: 11, event: 'runtime.ready', mode: 'emit', argCount: 0, registeredListeners: 1 })
    const wireEvents = await client.callTool({ name: 'cordis_devtools_send', arguments: { id: 43, sessionId, method: 'Cordis.readEvents', params: { afterSequence: 0, method: 'Cordis.dispatchObserved' } } })
    expect(wireEvents.structuredContent).toMatchObject({ id: 43, result: { outcome: 'ok', events: [{ method: 'Cordis.dispatchObserved', params: { sequence: 1, event: 'runtime.ready' } }] }, sessionId })
    const events = await client.callTool({ name: 'cordis_devtools_read_events', arguments: { sessionId, afterSequence: 0, method: 'Cordis.dispatchObserved' } })
    expect(events.structuredContent).toMatchObject({ outcome: 'ok', events: [{ method: 'Cordis.dispatchObserved', params: { sequence: 1, event: 'runtime.ready' } }] })
    expect((await client.callTool({ name: 'cordis_devtools_detach', arguments: { sessionId } })).structuredContent).toMatchObject({ debugSessionId: sessionId, status: 'detached' })
    runtime.service.dispose()
  })

  it('keeps generic profiler mutation behind MCP authentication and capability', async () => {
    const runtime = createRuntime()
    const handle = await startEmbeddedMcpServer(runtime.diagnostics, { port: 0, token: 'secret', protocol: runtime.protocol })
    handles.push(handle)
    const client = new Client({ name: 'protocol-mcp-auth-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url), { requestInit: { headers: { Authorization: 'Bearer secret' } } }))
    const targetId = runtime.service.listTargets()[0].targetId
    const attached = await client.callTool({ name: 'cordis_devtools_attach', arguments: { targetId } })
    const sessionId = (attached.structuredContent as { debugSessionId: string }).debugSessionId
    const denied = await client.callTool({ name: 'cordis_devtools_send', arguments: { sessionId, method: 'Profiler.startExperiment' } })
    expect(denied.structuredContent).toMatchObject({ error: { code: 'not_authorized' } })
    runtime.service.dispose()
  })
})
