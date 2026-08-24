import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import {
  startEmbeddedMcpServer,
  type EmbeddedMcpHandle,
  type EmbeddedMcpOptions,
  type McpWaterfallExperimentControl,
} from '../src/host/mcp.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const handles: EmbeddedMcpHandle[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map(client => client.close()))
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
  vi.restoreAllMocks()
})

function diagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = {
    generatedAt: 1,
    events: [],
    listeners: [],
    fibers: [],
    dispatches: [],
  }
  const profiler: WaterfallProfilerSnapshot = {
    generatedAt: 2,
    instrumentation: 'disabled',
    traces: [],
  }
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

function experimentControl(): McpWaterfallExperimentControl {
  return {
    status: vi.fn(() => ({
      generatedAt: 10,
      instrumentation: 'disabled' as const,
      owner: { kind: 'none' as const },
    })),
    startAgent: vi.fn((source, input) => ({
      outcome: 'started' as const,
      lease: {
        leaseId: 'lease-mcp',
        source,
        startedAt: 10,
        expiresAt: 10 + (input?.ttlMs ?? 15_000),
      },
      status: {
        generatedAt: 10,
        instrumentation: 'enabled' as const,
        owner: {
          kind: 'agent' as const,
          leaseId: 'lease-mcp',
          source,
          startedAt: 10,
          expiresAt: 10 + (input?.ttlMs ?? 15_000),
        },
      },
    })),
    stopAgent: vi.fn(input => ({
      outcome: input.leaseId === 'lease-mcp' ? 'stopped' as const : 'lease-mismatch' as const,
      status: {
        generatedAt: 20,
        instrumentation: 'disabled' as const,
        owner: { kind: 'none' as const },
      },
    })),
  }
}

async function start(options: EmbeddedMcpOptions): Promise<EmbeddedMcpHandle> {
  const handle = await startEmbeddedMcpServer(diagnostics(), { port: 0, ...options })
  handles.push(handle)
  return handle
}

async function connect(
  handle: EmbeddedMcpHandle,
  token?: string,
): Promise<Client> {
  const client = new Client({ name: 'mcp-experiment-auth-test', version: '1.0.0' })
  clients.push(client)
  const transport = new StreamableHTTPClientTransport(
    new URL(handle.url),
    token === undefined
      ? undefined
      : { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  )
  await client.connect(transport)
  return client
}

describe('embedded MCP experiment authority', () => {
  it('keeps v0.5 read-only tools compatible when no experiment control is supplied', async () => {
    const client = await connect(await start({}))
    const listed = await client.listTools()

    expect(listed.tools.map(tool => tool.name)).toEqual([
      'cordis_runtime_summary',
      'cordis_inspect_event',
      'cordis_inspect_fiber',
      'cordis_search_dispatches',
      'cordis_profiler_traces',
      'cordis_capture_checkpoint',
      'cordis_compare_current',
    ])
  })

  it('can expose read-only experiment status without exposing mutation tools', async () => {
    const control = experimentControl()
    const client = await connect(await start({ experiments: { control } }))
    const listed = await client.listTools()
    const names = listed.tools.map(tool => tool.name)

    expect(names).toContain('cordis_waterfall_experiment_status')
    expect(names).not.toContain('cordis_start_waterfall_experiment')
    expect(names).not.toContain('cordis_stop_waterfall_experiment')

    const status = await client.callTool({ name: 'cordis_waterfall_experiment_status', arguments: {} })
    expect(status.isError).not.toBe(true)
    expect(status.structuredContent).toEqual(control.status())
    expect(control.startAgent).not.toHaveBeenCalled()
    expect(control.stopAgent).not.toHaveBeenCalled()
  })

  it('refuses to enable external mutation without a non-empty bearer token and live control', async () => {
    const control = experimentControl()
    await expect(startEmbeddedMcpServer(diagnostics(), {
      port: 0,
      experiments: { enabled: true, control },
    })).rejects.toThrow('require a non-empty bearer token')

    await expect(startEmbeddedMcpServer(diagnostics(), {
      port: 0,
      token: '   ',
      experiments: { enabled: true, control },
    })).rejects.toThrow('must not be empty')

    await expect(startEmbeddedMcpServer(diagnostics(), {
      port: 0,
      token: 'secret',
      experiments: { enabled: true },
    })).rejects.toThrow('require an experiment control')
  })

  it('protects every MCP request when a token is configured', async () => {
    const handle = await start({ token: 'secret' })

    await expect(connect(handle)).rejects.toThrow()
    await expect(connect(handle, 'wrong')).rejects.toThrow()

    const authenticated = await connect(handle, 'secret')
    const summary = await authenticated.callTool({ name: 'cordis_runtime_summary', arguments: {} })
    expect(summary.isError).not.toBe(true)
    expect(summary.structuredContent).toMatchObject({ events: 0, listeners: 0, liveFibers: 0 })
  })

  it('exposes authenticated start/stop only under the explicit experiment capability', async () => {
    const control = experimentControl()
    const client = await connect(await start({
      token: 'secret',
      experiments: { enabled: true, control },
    }), 'secret')
    const listed = await client.listTools()
    const startTool = listed.tools.find(tool => tool.name === 'cordis_start_waterfall_experiment')
    const stopTool = listed.tools.find(tool => tool.name === 'cordis_stop_waterfall_experiment')

    expect(startTool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(stopTool?.annotations?.readOnlyHint).toBe(false)

    const started = await client.callTool({
      name: 'cordis_start_waterfall_experiment',
      arguments: { ttlMs: 2_500 },
    })
    expect(started.isError).not.toBe(true)
    expect(started.structuredContent).toMatchObject({
      outcome: 'started',
      lease: { leaseId: 'lease-mcp', source: 'mcp', expiresAt: 2_510 },
    })
    expect(control.startAgent).toHaveBeenCalledWith('mcp', { ttlMs: 2_500 })

    const stopped = await client.callTool({
      name: 'cordis_stop_waterfall_experiment',
      arguments: { leaseId: 'lease-mcp' },
    })
    expect(stopped.isError).not.toBe(true)
    expect(stopped.structuredContent).toMatchObject({ outcome: 'stopped' })
    expect(control.stopAgent).toHaveBeenCalledWith({ leaseId: 'lease-mcp' })
  })

  it('never returns bearer token material through status/tool-list results', async () => {
    const secret = 'do-not-leak-this-token'
    const control = experimentControl()
    const client = await connect(await start({
      token: secret,
      experiments: { enabled: true, control },
    }), secret)

    const listed = await client.listTools()
    const status = await client.callTool({ name: 'cordis_waterfall_experiment_status', arguments: {} })
    expect(JSON.stringify({ listed, status })).not.toContain(secret)
  })
})
