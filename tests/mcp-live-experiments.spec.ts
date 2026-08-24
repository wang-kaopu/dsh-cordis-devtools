import { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createMcpExperimentControl } from '../src/host/mcp-experiment-control.js'
import { startEmbeddedMcpServer, type EmbeddedMcpHandle } from '../src/host/mcp.js'
import { DevtoolsService } from '../src/host/service.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'devtools/mcp-live-experiment'(steps: string[], next: () => unknown): unknown
  }
}

let handle: EmbeddedMcpHandle | undefined
let client: Client | undefined
let service: DevtoolsService | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
  await handle?.close()
  handle = undefined
  service?.dispose()
  service = undefined
})

async function connect(url: string, token: string): Promise<Client> {
  const next = new Client({ name: 'dsh-cordis-devtools-live-experiment-test', version: '1.0.0' })
  await next.connect(new StreamableHTTPClientTransport(
    new URL(url),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  ))
  client = next
  return next
}

function structured<T>(value: Awaited<ReturnType<Client['callTool']>>): T {
  return value.structuredContent as T
}

describe('embedded MCP live experiment integration', () => {
  it('runs authenticated start -> real Cordis waterfall -> tagged trace -> exact stop on one live service', async () => {
    const token = 'live-test-secret'
    const ctx = new Context()
    ctx.on('devtools/mcp-live-experiment', (steps, next) => {
      steps.push('listener')
      return next()
    })
    service = new DevtoolsService(ctx)
    handle = await startEmbeddedMcpServer(service.diagnostics, {
      port: 0,
      token,
      experiments: { enabled: true, control: createMcpExperimentControl(service) },
    })
    const connected = await connect(handle.url, token)

    const listed = await connected.listTools()
    expect(listed.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'cordis_waterfall_experiment_status',
      'cordis_start_waterfall_experiment',
      'cordis_stop_waterfall_experiment',
    ]))

    const startedCall = await connected.callTool({
      name: 'cordis_start_waterfall_experiment',
      arguments: { ttlMs: 10_000 },
    })
    expect(startedCall.isError).not.toBe(true)
    const started = structured<{
      outcome: string
      lease: { leaseId: string; source: string } | null
    }>(startedCall)
    expect(started).toMatchObject({ outcome: 'started', lease: { source: 'mcp' } })
    const leaseId = started.lease?.leaseId
    expect(leaseId).toEqual(expect.any(String))

    const steps: string[] = []
    expect(ctx.waterfall('devtools/mcp-live-experiment', steps, () => 'done')).toBe('done')
    expect(steps).toEqual(['listener'])

    // The same live Host query is the source behind MCP; the trace must carry
    // the exact coordinator lease rather than a timestamp-inferred association.
    expect(service.diagnostics.profilerTraces({ experimentId: leaseId }).traces).toEqual([
      expect.objectContaining({
        event: 'devtools/mcp-live-experiment',
        experimentId: leaseId,
      }),
    ])

    // External clients must get the same exact filter through the MCP schema and
    // delegation rather than relying on a timestamp or reading the Host directly.
    const tracesCall = await connected.callTool({
      name: 'cordis_profiler_traces',
      arguments: { event: 'devtools/mcp-live-experiment', experimentId: leaseId, limit: 20 },
    })
    expect(tracesCall.isError).not.toBe(true)
    expect(structured<{ traces: Array<{ event: string; experimentId?: string }> }>(tracesCall).traces).toEqual([
      expect.objectContaining({
        event: 'devtools/mcp-live-experiment',
        experimentId: leaseId,
      }),
    ])

    const statusCall = await connected.callTool({
      name: 'cordis_waterfall_experiment_status',
      arguments: {},
    })
    expect(structured(statusCall)).toMatchObject({
      instrumentation: 'enabled',
      owner: { kind: 'agent', source: 'mcp', leaseId },
    })

    const stoppedCall = await connected.callTool({
      name: 'cordis_stop_waterfall_experiment',
      arguments: { leaseId },
    })
    expect(structured(stoppedCall)).toMatchObject({
      outcome: 'stopped',
      status: { instrumentation: 'disabled', owner: { kind: 'none' } },
    })
    expect(Object.prototype.hasOwnProperty.call(ctx.events, 'dispatch')).toBe(false)
  })
})
