import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import {
  installEmbeddedMcpServer,
  startEmbeddedMcpServer,
  type EmbeddedMcpHandle,
} from '../src/host/mcp.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

let handle: EmbeddedMcpHandle | undefined
let client: Client | undefined
let blocker: TcpServer | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
  await handle?.close()
  handle = undefined
  await closeTcpServer(blocker)
  blocker = undefined
  vi.restoreAllMocks()
})

function diagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = {
    generatedAt: 10,
    events: [{ name: 'demo/event', listenerCount: 1, listenerIds: [1] }],
    listeners: [{
      id: 1,
      event: 'demo/event',
      order: 0,
      prepend: false,
      global: false,
      owner: { uid: 7, name: 'demo', state: 'active' },
    }],
    fibers: [{
      uid: 7,
      name: 'demo',
      state: 'active',
      parent: null,
      inject: ['connection'],
      effects: [{ label: 'ctx.on(demo/event)', children: [] }],
    }],
    dispatches: [{
      id: 1,
      timestamp: 5,
      mode: 'emit',
      event: 'demo/event',
      argCount: 0,
      registeredListeners: 1,
      thisFiber: { uid: 7, name: 'demo', state: 'active' },
    }],
  }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 11,
    instrumentation: 'disabled',
    traces: [],
  }
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

async function connect(query: RuntimeDiagnosticsQuery = diagnostics()) {
  handle = await startEmbeddedMcpServer(query, { port: 0 })
  client = new Client({ name: 'dsh-cordis-devtools-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)))
  return client
}

async function occupyLoopbackPort(): Promise<number> {
  blocker = createTcpServer()
  await new Promise<void>((resolve, reject) => {
    blocker!.once('error', reject)
    blocker!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = blocker.address()
  if (address === null || typeof address === 'string') throw new Error('missing occupied TCP port')
  return address.port
}

async function closeTcpServer(server: TcpServer | undefined): Promise<void> {
  if (server === undefined || !server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}

describe('embedded MCP diagnostics', () => {
  it('binds to loopback and exposes exactly the five read-only tools', async () => {
    const connected = await connect()
    expect(handle?.host).toBe('127.0.0.1')
    expect(handle?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

    const listed = await connected.listTools()
    expect(listed.tools.map(tool => tool.name)).toEqual([
      'cordis_runtime_summary',
      'cordis_inspect_event',
      'cordis_inspect_fiber',
      'cordis_search_dispatches',
      'cordis_profiler_traces',
    ])
    expect(listed.tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true)
  })

  it('returns exactly the canonical direct-query event result through a real MCP call', async () => {
    const query = diagnostics()
    const connected = await connect(query)
    const result = await connected.callTool({
      name: 'cordis_inspect_event',
      arguments: { name: 'demo/event' },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual(query.inspectEvent('demo/event'))
  })

  it('preserves bounded dispatch semantics and keeps profiler reads disabled', async () => {
    const connected = await connect()
    const dispatches = await connected.callTool({
      name: 'cordis_search_dispatches',
      arguments: { event: 'missing/event' },
    })
    expect(dispatches.structuredContent).toMatchObject({
      records: [],
      window: { bounded: true, retained: 1, matched: 0, returned: 0, truncated: false },
    })

    const profiler = await connected.callTool({
      name: 'cordis_profiler_traces',
      arguments: {},
    })
    expect(profiler.structuredContent).toMatchObject({
      instrumentation: 'disabled',
      traces: [],
      window: { bounded: true },
    })
  })

  it('returns invalid Fiber selectors as MCP tool errors instead of mutating runtime', async () => {
    const connected = await connect()
    const result = await connected.callTool({
      name: 'cordis_inspect_fiber',
      arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('exactly one') }),
    ]))
  })

  it('contains listener startup failure by default and supports explicit fail-fast', async () => {
    const port = await occupyLoopbackPort()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(installEmbeddedMcpServer(new Context(), diagnostics(), { port })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('MCP diagnostics failed to start'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE'))

    await expect(installEmbeddedMcpServer(new Context(), diagnostics(), {
      port,
      failOnStartupError: true,
    })).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})
