import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import {
  startEmbeddedMcpServer,
  type EmbeddedMcpHandle,
  type EmbeddedMcpOptions,
  type McpAgentDebugControl,
  type McpWaterfallExperimentControl,
} from '../src/host/mcp.js'
import type {
  AgentDebugExplorationSnapshot,
  AgentDebugSessionDetail,
  AgentDebugTarget,
  AgentDebugWaitForRuntimeChangeResult,
} from '../src/shared/agent-debug.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const handles: EmbeddedMcpHandle[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map(client => client.close()))
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
})

function diagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = { generatedAt: 1, events: [], listeners: [], fibers: [], dispatches: [] }
  const profiler: WaterfallProfilerSnapshot = { generatedAt: 2, instrumentation: 'disabled', traces: [] }
  return new RuntimeDiagnosticsQuery({
    snapshot: () => structuredClone(observer),
    profilerSnapshot: () => structuredClone(profiler),
  })
}

function target(): AgentDebugTarget {
  return {
    targetId: 'target-1',
    targetEpoch: 1,
    type: 'cordis-runtime',
    status: 'active',
    metadata: { title: 'DSH', pluginVersion: '0.6.0', cordisVersion: '4.0.1' },
    capabilities: ['target-discovery', 'debug-session', 'runtime-snapshot', 'runtime-wait', 'checkpoint-compare', 'waterfall-profiler'],
  }
}

function session(status: AgentDebugSessionDetail['status'] = 'active'): AgentDebugSessionDetail {
  return {
    debugSessionId: 'session-1',
    targetId: 'target-1',
    targetEpoch: 1,
    status,
    stale: status === 'stale',
    staleReason: status === 'stale' ? 'target-replaced' : null,
    createdAt: 1,
    lastAccessedAt: 2,
    observationSequence: 4,
  }
}

function snapshot(): AgentDebugExplorationSnapshot {
  return {
    generatedAt: 3,
    eventCursor: 4,
    target: target(),
    session: session(),
    summary: { generatedAt: 3, events: 1, listeners: 1, liveFibers: 1, dispatchesRetained: 1, tracesRetained: 0 },
    events: null,
    fibers: null,
    dispatches: null,
    profiler: null,
    candidates: null,
  }
}

function waitResult(outcome: AgentDebugWaitForRuntimeChangeResult['outcome']): AgentDebugWaitForRuntimeChangeResult {
  return {
    outcome,
    observation: outcome === 'found'
      ? { sequence: 5, observedAt: 4, type: 'topology-invalidated', reason: 'snapshot' }
      : null,
    window: { bounded: true, oldestSequence: 1, newestSequence: 5, retained: 5, truncated: false, gap: outcome === 'gap' },
    session: session(),
  } as AgentDebugWaitForRuntimeChangeResult
}

function agentDebugControl(): McpAgentDebugControl {
  return {
    listTargets: vi.fn(() => [target()]),
    attachDebugSession: vi.fn(() => session()),
    debugSnapshot: vi.fn(() => snapshot()),
    waitForRuntimeChange: vi.fn(async () => waitResult('found')),
    detachDebugSession: vi.fn(() => session('stale')),
    startAgent: vi.fn((debugSessionId, _source, input) => ({
      outcome: 'started' as const,
      lease: { leaseId: 'lease-1', source: 'mcp' as const, startedAt: 1, expiresAt: 1 + (input?.ttlMs ?? 15_000), debugSessionId },
      status: { generatedAt: 1, instrumentation: 'enabled' as const, owner: { kind: 'none' as const } },
    })),
    stopAgent: vi.fn((_debugSessionId, _input) => ({
      outcome: 'stopped' as const,
      status: { generatedAt: 2, instrumentation: 'disabled' as const, owner: { kind: 'none' as const } },
    })),
  }
}

function experimentControl(): McpWaterfallExperimentControl {
  return {
    status: vi.fn(() => ({ generatedAt: 1, instrumentation: 'disabled' as const, owner: { kind: 'none' as const } })),
    startAgent: vi.fn((_source, input) => ({
      outcome: 'started' as const,
      lease: { leaseId: 'lease-1', source: 'mcp' as const, startedAt: 1, expiresAt: 1 + (input?.ttlMs ?? 15_000) },
      status: { generatedAt: 1, instrumentation: 'enabled' as const, owner: { kind: 'none' as const } },
    })),
    stopAgent: vi.fn(() => ({ outcome: 'stopped' as const, status: { generatedAt: 2, instrumentation: 'disabled' as const, owner: { kind: 'none' as const } } })),
  }
}

async function start(options: EmbeddedMcpOptions = {}): Promise<EmbeddedMcpHandle> {
  const handle = await startEmbeddedMcpServer(diagnostics(), { port: 0, ...options })
  handles.push(handle)
  return handle
}

async function connect(handle: EmbeddedMcpHandle, token?: string): Promise<Client> {
  const client = new Client({ name: 'mcp-agent-debug-test', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(
    new URL(handle.url),
    token === undefined ? undefined : { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  ))
  return client
}

describe('embedded MCP Agent Debug adapter', () => {
  it('keeps existing tools first, exposes debug tools as a family, and forwards the full workflow', async () => {
    const control = agentDebugControl()
    const client = await connect(await start({ agentDebug: control }))
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual([
      'cordis_runtime_summary', 'cordis_inspect_event', 'cordis_inspect_fiber', 'cordis_search_dispatches',
      'cordis_profiler_traces', 'cordis_capture_checkpoint', 'cordis_compare_current',
      'cordis_list_debug_targets', 'cordis_attach_debug_session', 'cordis_debug_snapshot',
      'cordis_wait_for_runtime_change', 'cordis_detach_debug_session',
    ])

    expect((await client.callTool({ name: 'cordis_list_debug_targets', arguments: {} })).structuredContent).toEqual({ targets: [target()] })
    expect((await client.callTool({ name: 'cordis_attach_debug_session', arguments: { targetId: 'target-1' } })).structuredContent).toEqual(session())
    expect((await client.callTool({
      name: 'cordis_debug_snapshot',
      arguments: { debugSessionId: 'session-1', sections: ['summary', 'events'], catalogs: { events: { limit: 10, cursor: 'cursor-1' } } },
    })).structuredContent).toEqual(snapshot())
    expect((await client.callTool({
      name: 'cordis_wait_for_runtime_change',
      arguments: { debugSessionId: 'session-1', afterSequence: 4, type: 'topology-invalidated', event: 'demo/event', timeoutMs: 10 },
    })).structuredContent).toEqual(waitResult('found'))
    expect((await client.callTool({ name: 'cordis_detach_debug_session', arguments: { debugSessionId: 'session-1' } })).structuredContent).toEqual(session('stale'))
    expect(control.debugSnapshot).toHaveBeenCalledWith({
      debugSessionId: 'session-1', sections: ['summary', 'events'], catalogs: { events: { limit: 10, cursor: 'cursor-1' } },
    })
  })

  it('returns found, timeout, gap, stale state, and control errors as MCP results', async () => {
    const control = agentDebugControl()
    vi.mocked(control.waitForRuntimeChange)
      .mockResolvedValueOnce(waitResult('timeout'))
      .mockResolvedValueOnce(waitResult('gap'))
    vi.mocked(control.attachDebugSession).mockImplementation(() => { throw new Error('stale target') })
    const client = await connect(await start({ agentDebug: control }))

    expect((await client.callTool({ name: 'cordis_wait_for_runtime_change', arguments: { debugSessionId: 'session-1' } })).structuredContent).toEqual(waitResult('timeout'))
    expect((await client.callTool({ name: 'cordis_wait_for_runtime_change', arguments: { debugSessionId: 'session-1' } })).structuredContent).toEqual(waitResult('gap'))
    const attach = await client.callTool({ name: 'cordis_attach_debug_session', arguments: { targetId: 'target-1' } })
    expect(attach.isError).toBe(true)

    vi.mocked(control.detachDebugSession).mockReturnValueOnce(null)
    const detach = await client.callTool({ name: 'cordis_detach_debug_session', arguments: { debugSessionId: 'missing' } })
    expect(detach.isError).toBe(true)
    expect(detach.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('already detached') })]))
  })

  it('does not let Agent Debug availability grant waterfall mutation authority', async () => {
    const control = agentDebugControl()
    const client = await connect(await start({ agentDebug: control, experiments: { control: experimentControl() } }))
    const names = (await client.listTools()).tools.map(tool => tool.name)
    expect(names).toContain('cordis_list_debug_targets')
    expect(names).toContain('cordis_waterfall_experiment_status')
    expect(names).not.toContain('cordis_start_waterfall_experiment')
    expect(names).not.toContain('cordis_stop_waterfall_experiment')
    const directMutation = await client.callTool({ name: 'cordis_start_waterfall_experiment', arguments: {} })
    expect(directMutation.isError).toBe(true)
  })

  it('keeps direct experiment control behavior for calls without a debug session', async () => {
    const experiments = experimentControl()
    const client = await connect(await start({
      token: 'secret',
      agentDebug: agentDebugControl(),
      experiments: { enabled: true, control: experiments },
    }), 'secret')
    const started = await client.callTool({ name: 'cordis_start_waterfall_experiment', arguments: { ttlMs: 100 } })
    expect(started.isError).not.toBe(true)
    expect(experiments.startAgent).toHaveBeenCalledWith('mcp', { ttlMs: 100 })
    const stopped = await client.callTool({ name: 'cordis_stop_waterfall_experiment', arguments: { leaseId: 'lease-1' } })
    expect(stopped.isError).not.toBe(true)
    expect(experiments.stopAgent).toHaveBeenCalledWith({ leaseId: 'lease-1' })
  })

  it('routes session-owned experiment start and stop through Agent Debug control', async () => {
    const agentDebug = agentDebugControl()
    const experiments = experimentControl()
    const client = await connect(await start({
      token: 'secret',
      agentDebug,
      experiments: { enabled: true, control: experiments },
    }), 'secret')
    const started = await client.callTool({ name: 'cordis_start_waterfall_experiment', arguments: { debugSessionId: 'session-1', ttlMs: 100 } })
    expect(started.isError).not.toBe(true)
    expect(agentDebug.startAgent).toHaveBeenCalledWith('session-1', 'mcp', { ttlMs: 100 })
    expect(experiments.startAgent).not.toHaveBeenCalled()

    const stopped = await client.callTool({ name: 'cordis_stop_waterfall_experiment', arguments: { debugSessionId: 'session-1', leaseId: 'lease-1' } })
    expect(stopped.isError).not.toBe(true)
    expect(agentDebug.stopAgent).toHaveBeenCalledWith('session-1', { leaseId: 'lease-1' })
    expect(experiments.stopAgent).not.toHaveBeenCalled()
  })

  it('rejects invalid snapshot and wait values before delegating', async () => {
    const control = agentDebugControl()
    const client = await connect(await start({ agentDebug: control }))
    for (const call of [
      { name: 'cordis_debug_snapshot', arguments: { debugSessionId: 'session-1', sections: ['unknown'] } },
      { name: 'cordis_debug_snapshot', arguments: { debugSessionId: 'session-1', catalogs: { events: null } } },
      { name: 'cordis_wait_for_runtime_change', arguments: { debugSessionId: 'session-1', type: 'unknown' } },
      { name: 'cordis_wait_for_runtime_change', arguments: { debugSessionId: 'session-1', timeoutMs: 60_001 } },
    ]) {
      const result = await client.callTool(call)
      expect(result.isError).toBe(true)
    }
    expect(control.debugSnapshot).not.toHaveBeenCalled()
    expect(control.waitForRuntimeChange).not.toHaveBeenCalled()
  })
})
