import { timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  WaterfallExperimentStartInput,
  WaterfallExperimentStartResult,
  WaterfallExperimentStatus,
  WaterfallExperimentStopInput,
  WaterfallExperimentStopResult,
} from '../shared/experiments.js'
import type { RuntimeCheckpoint, RuntimeCheckpointScope } from '../shared/verification.js'
import {
  AGENT_DEBUG_OBSERVATION_TYPES,
  AGENT_DEBUG_SNAPSHOT_SECTIONS,
  MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS,
} from '../shared/agent-debug.js'
import type {
  AgentDebugExplorationSnapshot,
  AgentDebugCatalogInput,
  AgentDebugObservationType,
  AgentDebugSessionDetail,
  AgentDebugSessionId,
  AgentDebugSnapshotInput,
  AgentDebugSnapshotSection,
  AgentDebugTarget,
  AgentDebugTargetId,
  AgentDebugWaitForRuntimeChangeInput,
  AgentDebugWaitForRuntimeChangeResult,
} from '../shared/agent-debug.js'
import type { RuntimeDiagnosticsQuery } from './diagnostics.js'

export const DEFAULT_MCP_PORT = 43127
export const MCP_PATH = '/mcp'

const MAX_BODY_BYTES = 1024 * 1024
const MCP_SERVER_INFO = { name: 'dsh-cordis-devtools', version: '0.8.0' } as const

export interface McpWaterfallExperimentControl {
  status(): WaterfallExperimentStatus
  startAgent(source: 'mcp', input?: WaterfallExperimentStartInput): WaterfallExperimentStartResult
  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult
}

/** Narrow MCP adapter for Agent Debug target/session operations. */
export interface McpAgentDebugControl {
  /** List currently discoverable Agent Debug targets. */
  listTargets(): readonly AgentDebugTarget[]
  /** Attach one MCP-owned debug session to a target. */
  attachDebugSession(targetId: AgentDebugTargetId): AgentDebugSessionDetail
  /** Explore the authoritative runtime state for one debug session. */
  debugSnapshot(input: AgentDebugSnapshotInput): AgentDebugExplorationSnapshot
  /** Wait for one bounded runtime observation after an optional sequence barrier. */
  waitForRuntimeChange(input: AgentDebugWaitForRuntimeChangeInput): Promise<AgentDebugWaitForRuntimeChangeResult>
  /** Detach one debug session, returning null when it is already unknown. */
  detachDebugSession(debugSessionId: AgentDebugSessionId): AgentDebugSessionDetail | null
  /** Start one waterfall experiment owned by an active Agent Debug session. */
  startAgent(
    debugSessionId: AgentDebugSessionId,
    source: 'mcp',
    input?: WaterfallExperimentStartInput,
  ): WaterfallExperimentStartResult
  /** Stop one waterfall experiment owned by an active Agent Debug session. */
  stopAgent(
    debugSessionId: AgentDebugSessionId,
    input: WaterfallExperimentStopInput,
  ): WaterfallExperimentStopResult
}

export interface EmbeddedMcpExperimentOptions {
  /** Expose mutating start/stop tools. Requires token + control. Default false. */
  enabled?: boolean
  /** Shared coordinator-compatible control; status can be exposed read-only when supplied. */
  control?: McpWaterfallExperimentControl
}

export interface EmbeddedMcpOptions {
  port?: number
  /** Optional bearer token. When present, every MCP request requires it. */
  token?: string
  /** Optional controlled-waterfall experiment capability. */
  experiments?: EmbeddedMcpExperimentOptions
  /** Optional Agent Debug target/session capability. */
  agentDebug?: McpAgentDebugControl
}

export interface EmbeddedMcpLifecycleOptions extends EmbeddedMcpOptions {
  /** Reject plugin activation when the MCP listener cannot start. Default false. */
  failOnStartupError?: boolean
}

export interface EmbeddedMcpHandle {
  host: '127.0.0.1'
  port: number
  url: string
  close(): Promise<void>
}

interface ActiveProtocolRequest {
  close(): Promise<void>
}

interface NormalizedMcpOptions {
  token: string | undefined
  experimentControl: McpWaterfallExperimentControl | undefined
  experimentsEnabled: boolean
  agentDebug: McpAgentDebugControl | undefined
}

const EMPTY_SCHEMA = objectSchema({})
const EVENT_SCHEMA = objectSchema(
  { name: { type: 'string', description: 'Exact live Cordis event name.' } },
  ['name'],
)
const FIBER_SCHEMA = objectSchema({
  uid: { type: 'number', description: 'Exact authoritative live Fiber uid.' },
  name: { type: 'string', description: 'Exact live Fiber name; may match multiple Fibers.' },
})
const DISPATCH_SCHEMA = objectSchema({
  event: { type: 'string', description: 'Exact event name filter.' },
  fiberUid: { type: 'number', description: 'Exact dispatch-context Fiber uid filter.' },
  mode: { type: 'string', description: 'Exact dispatch mode filter.' },
  limit: { type: 'number', description: 'Maximum returned records, 1 through 100.' },
})
const PROFILER_SCHEMA = objectSchema({
  event: { type: 'string', description: 'Exact waterfall event name filter.' },
  experimentId: { type: 'string', description: 'Exact controlled experiment/lease id filter.' },
  limit: { type: 'number', description: 'Maximum returned traces, 1 through 100.' },
})
const CHECKPOINT_SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    eventNames: { type: 'array', items: { type: 'string' }, description: 'Exact event names to include.' },
    fiberNames: { type: 'array', items: { type: 'string' }, description: 'Exact live Fiber names to include.' },
  },
  additionalProperties: false,
} as const
const CHECKPOINT_SCHEMA = objectSchema({
  scope: CHECKPOINT_SCOPE_SCHEMA,
})
const COMPARE_SCHEMA = objectSchema({
  baseline: { type: 'object', description: 'Self-contained RuntimeCheckpoint returned by cordis_capture_checkpoint.' },
}, ['baseline'])
const EXPERIMENT_START_SCHEMA = objectSchema({
  ttlMs: { type: 'number', description: 'Finite waterfall experiment lease duration in milliseconds.' },
  debugSessionId: { type: 'string', description: 'Optional exact Agent Debug session that owns the experiment.' },
})
const EXPERIMENT_STOP_SCHEMA = objectSchema({
  leaseId: { type: 'string', description: 'Exact lease id returned by cordis_start_waterfall_experiment.' },
  debugSessionId: { type: 'string', description: 'Optional exact Agent Debug session that owns the experiment.' },
}, ['leaseId'])

const READ_ONLY_TOOLS: Tool[] = [
  readOnlyTool('cordis_runtime_summary', 'Return compact live Cordis counts and bounded evidence-window metadata.', EMPTY_SCHEMA),
  readOnlyTool('cordis_inspect_event', 'Inspect current live listener registrations for one exact Cordis event.', EVENT_SCHEMA),
  readOnlyTool('cordis_inspect_fiber', 'Inspect one live Fiber uid or all live Fibers with one exact name.', FIBER_SCHEMA),
  readOnlyTool('cordis_search_dispatches', 'Search the retained bounded observer dispatch window newest-first.', DISPATCH_SCHEMA),
  readOnlyTool('cordis_profiler_traces', 'Read existing retained waterfall profiler traces without enabling instrumentation.', PROFILER_SCHEMA),
  readOnlyTool('cordis_capture_checkpoint', 'Capture a self-contained authoritative Cordis runtime topology checkpoint.', CHECKPOINT_SCHEMA),
  readOnlyTool('cordis_compare_current', 'Compare a caller-owned checkpoint with fresh current Cordis runtime topology.', COMPARE_SCHEMA),
]

const EXPERIMENT_STATUS_TOOL = readOnlyTool(
  'cordis_waterfall_experiment_status',
  'Read the current controlled waterfall instrumentation owner and lease status.',
  EMPTY_SCHEMA,
)
const EXPERIMENT_START_TOOL = mutationTool(
  'cordis_start_waterfall_experiment',
  'Start one finite external-Agent waterfall profiling experiment lease.',
  EXPERIMENT_START_SCHEMA,
)
const EXPERIMENT_STOP_TOOL = mutationTool(
  'cordis_stop_waterfall_experiment',
  'Stop only the exact active external-Agent waterfall experiment lease.',
  EXPERIMENT_STOP_SCHEMA,
)

const AGENT_DEBUG_TARGETS_TOOL = readOnlyTool(
  'cordis_list_debug_targets',
  'List discoverable DSH runtime targets available for Agent Debug sessions.',
  EMPTY_SCHEMA,
)
const AGENT_DEBUG_ATTACH_TOOL = readOnlyTool(
  'cordis_attach_debug_session',
  'Attach a debug session to one exact DSH runtime target.',
  objectSchema({ targetId: { type: 'string', description: 'Exact target id returned by cordis_list_debug_targets.' } }, ['targetId']),
  false,
)
const AGENT_DEBUG_SNAPSHOT_TOOL = readOnlyTool(
  'cordis_debug_snapshot',
  'Explore bounded authoritative DSH runtime metadata for one debug session.',
  objectSchema({
    debugSessionId: { type: 'string', description: 'Exact debug session id returned by cordis_attach_debug_session.' },
    sections: { type: 'array', items: { type: 'string', enum: [...AGENT_DEBUG_SNAPSHOT_SECTIONS] }, description: 'Optional sections to include.' },
    catalogs: { type: 'object', description: 'Optional per-catalog paging options.' },
  }, ['debugSessionId']),
  false,
)
const AGENT_DEBUG_WAIT_TOOL = readOnlyTool(
  'cordis_wait_for_runtime_change',
  'Wait for one bounded DSH runtime observation after an optional sequence barrier.',
  objectSchema({
    debugSessionId: { type: 'string', description: 'Exact debug session id returned by cordis_attach_debug_session.' },
    afterSequence: { type: 'number', description: 'Optional target-local sequence barrier.' },
    type: { type: 'string', enum: [...AGENT_DEBUG_OBSERVATION_TYPES], description: 'Optional exact observation type filter.' },
    event: { type: 'string', description: 'Optional exact event-name filter.' },
    timeoutMs: { type: 'number', description: 'Optional bounded wait duration in milliseconds.' },
  }, ['debugSessionId']),
  false,
)
const AGENT_DEBUG_DETACH_TOOL = readOnlyTool(
  'cordis_detach_debug_session',
  'Detach one exact DSH Agent Debug session.',
  objectSchema({ debugSessionId: { type: 'string', description: 'Exact debug session id to detach.' } }, ['debugSessionId']),
  false,
)
const AGENT_DEBUG_TOOLS = [
  AGENT_DEBUG_TARGETS_TOOL,
  AGENT_DEBUG_ATTACH_TOOL,
  AGENT_DEBUG_SNAPSHOT_TOOL,
  AGENT_DEBUG_WAIT_TOOL,
  AGENT_DEBUG_DETACH_TOOL,
]

/**
 * Own the optional MCP listener inside the plugin Fiber without making MCP
 * availability a prerequisite for the human DevTools/observer path by default.
 */
export async function installEmbeddedMcpServer(
  ctx: Context,
  diagnostics: RuntimeDiagnosticsQuery,
  options: EmbeddedMcpLifecycleOptions = {},
): Promise<void> {
  await ctx.effect(async () => {
    try {
      const handle = await startEmbeddedMcpServer(diagnostics, options)
      console.info(`[dsh-cordis-devtools] MCP diagnostics: ${handle.url}`)
      return () => handle.close()
    } catch (error) {
      if (options.failOnStartupError === true) throw error
      console.error(`[dsh-cordis-devtools] MCP diagnostics failed to start: ${errorMessage(error)}`)
      return () => {}
    }
  }, 'dsh-cordis-devtools: embedded MCP diagnostics')
}

export async function startEmbeddedMcpServer(
  diagnostics: RuntimeDiagnosticsQuery,
  options: EmbeddedMcpOptions = {},
): Promise<EmbeddedMcpHandle> {
  const port = normalizePort(options.port ?? DEFAULT_MCP_PORT)
  const normalized = normalizeMcpOptions(options)
  const active = new Set<ActiveProtocolRequest>()
  let closing = false

  const http = createHttpServer(async (req, res) => {
    if (closing) {
      writeJson(res, 503, { error: 'Cordis DevTools MCP server is shutting down' })
      return
    }

    const path = requestPath(req)
    if (path !== MCP_PATH) {
      writeJson(res, 404, { error: 'not found' })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      writeJson(res, 405, { error: 'method not allowed' })
      return
    }
    if (!isAuthorized(req, normalized.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      writeJson(res, 401, { error: 'unauthorized' })
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid request body' })
      return
    }

    const server = createProtocolServer(diagnostics, normalized)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    let cleaned = false
    const entry: ActiveProtocolRequest = {
      async close() {
        if (cleaned) return
        cleaned = true
        active.delete(entry)
        await Promise.allSettled([transport.close(), server.close()])
      },
    }
    active.add(entry)
    res.once('close', () => { void entry.close() })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : 'MCP request failed' })
      } else if (!res.writableEnded) {
        res.end()
      }
      await entry.close()
    }
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    http.once('error', onError)
    http.listen(port, '127.0.0.1', () => {
      http.off('error', onError)
      resolve()
    })
  })

  const address = http.address()
  if (address === null || typeof address === 'string') {
    await closeHttpServer(http)
    throw new Error('dsh-cordis-devtools: MCP server did not expose a TCP address')
  }
  const actualPort = (address as AddressInfo).port

  return {
    host: '127.0.0.1',
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}${MCP_PATH}`,
    async close() {
      if (closing) return
      closing = true
      await Promise.allSettled([...active].map(entry => entry.close()))
      await closeHttpServer(http)
    },
  }
}

function createProtocolServer(
  diagnostics: RuntimeDiagnosticsQuery,
  options: NormalizedMcpOptions,
): Server {
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } })
  const tools = experimentTools(options)

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = readObject(request.params.arguments)
      let value: unknown
      switch (request.params.name) {
        case 'cordis_runtime_summary':
          value = diagnostics.runtimeSummary()
          break
        case 'cordis_inspect_event':
          value = diagnostics.inspectEvent(readRequiredString(args, 'name'))
          break
        case 'cordis_inspect_fiber': {
          const uid = readOptionalNumber(args, 'uid')
          const name = readOptionalString(args, 'name')
          if ((uid === undefined) === (name === undefined)) {
            throw new TypeError('cordis_inspect_fiber requires exactly one of uid or name')
          }
          value = diagnostics.inspectFiber(uid === undefined ? { name: name! } : { uid })
          break
        }
        case 'cordis_search_dispatches': {
          const event = readOptionalString(args, 'event')
          const fiberUid = readOptionalNumber(args, 'fiberUid')
          const mode = readOptionalString(args, 'mode')
          const limit = readOptionalNumber(args, 'limit')
          value = diagnostics.searchDispatches({
            ...(event === undefined ? {} : { event }),
            ...(fiberUid === undefined ? {} : { fiberUid }),
            ...(mode === undefined ? {} : { mode }),
            ...(limit === undefined ? {} : { limit }),
          })
          break
        }
        case 'cordis_profiler_traces': {
          const event = readOptionalString(args, 'event')
          const experimentId = readOptionalString(args, 'experimentId')
          const limit = readOptionalNumber(args, 'limit')
          value = diagnostics.profilerTraces({
            ...(event === undefined ? {} : { event }),
            ...(experimentId === undefined ? {} : { experimentId }),
            ...(limit === undefined ? {} : { limit }),
          })
          break
        }
        case 'cordis_capture_checkpoint': {
          const scope = args.scope === undefined ? undefined : readCheckpointScope(args.scope)
          value = diagnostics.captureCheckpoint(scope === undefined ? {} : { scope })
          break
        }
        case 'cordis_compare_current':
          value = diagnostics.compareCurrent({ baseline: readCheckpoint(args, 'baseline') })
          break
        case 'cordis_list_debug_targets':
          value = { targets: requireAgentDebugControl(options).listTargets() }
          break
        case 'cordis_attach_debug_session':
          value = requireAgentDebugControl(options).attachDebugSession(readRequiredString(args, 'targetId'))
          break
        case 'cordis_debug_snapshot': {
          const debugSessionId = readRequiredString(args, 'debugSessionId')
          const sections = readOptionalSnapshotSections(args)
          const catalogs = readOptionalSnapshotCatalogs(args)
          value = requireAgentDebugControl(options).debugSnapshot({
            debugSessionId,
            ...(sections === undefined ? {} : { sections }),
            ...(catalogs === undefined ? {} : { catalogs }),
          })
          break
        }
        case 'cordis_wait_for_runtime_change': {
          const input = readRuntimeWaitInput(args)
          value = await requireAgentDebugControl(options).waitForRuntimeChange(input)
          break
        }
        case 'cordis_detach_debug_session': {
          const detached = requireAgentDebugControl(options).detachDebugSession(readRequiredString(args, 'debugSessionId'))
          if (detached === null) throw new Error('debug session is unavailable or already detached')
          value = detached
          break
        }
        case 'cordis_waterfall_experiment_status':
          value = requireExperimentControl(options).status()
          break
        case 'cordis_start_waterfall_experiment': {
          requireExperimentMutation(options)
          const ttlMs = readOptionalPositiveNumber(args, 'ttlMs')
          const debugSessionId = readOptionalString(args, 'debugSessionId')
          const input = ttlMs === undefined ? {} : { ttlMs }
          value = debugSessionId === undefined
            ? requireExperimentControl(options).startAgent('mcp', input)
            : requireAgentDebugControl(options).startAgent(debugSessionId, 'mcp', input)
          break
        }
        case 'cordis_stop_waterfall_experiment': {
          requireExperimentMutation(options)
          const leaseId = readRequiredString(args, 'leaseId')
          const debugSessionId = readOptionalString(args, 'debugSessionId')
          value = debugSessionId === undefined
            ? requireExperimentControl(options).stopAgent({ leaseId })
            : requireAgentDebugControl(options).stopAgent(debugSessionId, { leaseId })
          break
        }
        default:
          throw new Error(`unknown Cordis DevTools MCP tool: ${request.params.name}`)
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value as Record<string, unknown>,
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: error instanceof Error ? error.message : 'Cordis DevTools MCP tool failed',
        }],
        isError: true,
      }
    }
  })

  return server
}

function experimentTools(options: NormalizedMcpOptions): Tool[] {
  const tools = [...READ_ONLY_TOOLS]
  if (options.agentDebug !== undefined) tools.push(...AGENT_DEBUG_TOOLS)
  if (options.experimentControl !== undefined) tools.push(EXPERIMENT_STATUS_TOOL)
  if (options.experimentsEnabled) tools.push(EXPERIMENT_START_TOOL, EXPERIMENT_STOP_TOOL)
  return tools
}

function readOnlyTool(name: string, description: string, inputSchema: Tool['inputSchema'], idempotent = true): Tool {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: idempotent,
      openWorldHint: false,
    },
  }
}

function mutationTool(name: string, description: string, inputSchema: Tool['inputSchema']): Tool {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }
}

function objectSchema(
  properties: Record<string, object>,
  required?: string[],
): Tool['inputSchema'] {
  return {
    type: 'object',
    properties,
    ...(required === undefined ? {} : { required }),
    additionalProperties: false,
  }
}

function normalizeMcpOptions(options: EmbeddedMcpOptions): NormalizedMcpOptions {
  const token = normalizeToken(options.token)
  const experimentControl = options.experiments?.control
  const experimentsEnabled = options.experiments?.enabled === true
  if (experimentsEnabled && token === undefined) {
    throw new Error('dsh-cordis-devtools: MCP experiments require a non-empty bearer token')
  }
  if (experimentsEnabled && experimentControl === undefined) {
    throw new Error('dsh-cordis-devtools: MCP experiments require an experiment control')
  }
  return { token, experimentControl, experimentsEnabled, agentDebug: options.agentDebug }
}

function normalizeToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  if (token.trim() === '') throw new Error('dsh-cordis-devtools: MCP bearer token must not be empty')
  return token
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined) return true
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = header.slice('Bearer '.length)
  const expectedBytes = Buffer.from(token)
  const presentedBytes = Buffer.from(presented)
  if (expectedBytes.byteLength !== presentedBytes.byteLength) return false
  return timingSafeEqual(expectedBytes, presentedBytes)
}

function requireExperimentControl(options: NormalizedMcpOptions): McpWaterfallExperimentControl {
  if (options.experimentControl === undefined) throw new Error('waterfall experiment control is unavailable')
  return options.experimentControl
}

function requireExperimentMutation(options: NormalizedMcpOptions): void {
  if (!options.experimentsEnabled) throw new Error('waterfall experiment mutation capability is disabled')
}

function requireAgentDebugControl(options: NormalizedMcpOptions): McpAgentDebugControl {
  if (options.agentDebug === undefined) throw new Error('Agent Debug control is unavailable')
  return options.agentDebug
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    return '/'
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('MCP request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('MCP request body is not valid JSON')
  }
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(value))
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('MCP port must be an integer between 0 and 65535')
  }
  return port
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('MCP tool arguments must be an object')
  }
  return value as Record<string, unknown>
}

function readRequiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${key} must be a non-empty string`)
  return value
}

function readOptionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

function readOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`)
  return value
}

function readOptionalPositiveNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = readOptionalNumber(row, key)
  if (value !== undefined && value <= 0) throw new RangeError(`${key} must be a positive finite number`)
  return value
}

function readOptionalStringArray(row: Record<string, unknown>, key: string): string[] | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${key} must be an array of strings`)
  }
  return [...value]
}

function readOptionalSnapshotSections(row: Record<string, unknown>): readonly AgentDebugSnapshotSection[] | undefined {
  const values = readOptionalStringArray(row, 'sections')
  if (values === undefined) return undefined
  for (const value of values) {
    if (!(AGENT_DEBUG_SNAPSHOT_SECTIONS as readonly string[]).includes(value)) {
      throw new TypeError(`sections contains unsupported section: ${value}`)
    }
  }
  return values as AgentDebugSnapshotSection[]
}

function readOptionalSnapshotCatalogs(
  row: Record<string, unknown>,
): AgentDebugSnapshotInput['catalogs'] | undefined {
  const value = row.catalogs
  if (value === undefined) return undefined
  const catalogs = readObject(value)
  const allowed = new Set(['events', 'fibers', 'dispatches', 'candidates'])
  const result: Record<string, AgentDebugCatalogInput> = {}
  for (const [key, input] of Object.entries(catalogs)) {
    if (!allowed.has(key)) throw new TypeError(`catalogs contains unsupported catalog: ${key}`)
    const catalog = readObject(input)
    for (const field of Object.keys(catalog)) {
      if (field !== 'limit' && field !== 'cursor') throw new TypeError(`${key} catalog contains unsupported field: ${field}`)
    }
    const limit = readOptionalPositiveInteger(catalog, 'limit')
    const cursor = readOptionalString(catalog, 'cursor')
    result[key] = {
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    }
  }
  return result as AgentDebugSnapshotInput['catalogs']
}

function readRuntimeWaitInput(row: Record<string, unknown>): AgentDebugWaitForRuntimeChangeInput {
  const debugSessionId = readRequiredString(row, 'debugSessionId')
  const afterSequence = readOptionalNonNegativeInteger(row, 'afterSequence')
  const type = readOptionalObservationType(row)
  const event = readOptionalString(row, 'event')
  const timeoutMs = readOptionalBoundedWaitTimeout(row)
  return {
    debugSessionId,
    ...(afterSequence === undefined ? {} : { afterSequence }),
    ...(type === undefined ? {} : { type }),
    ...(event === undefined ? {} : { event }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
}

function readOptionalObservationType(row: Record<string, unknown>): AgentDebugObservationType | undefined {
  const value = readOptionalString(row, 'type')
  if (value === undefined) return undefined
  if (!(AGENT_DEBUG_OBSERVATION_TYPES as readonly string[]).includes(value)) {
    throw new TypeError(`type contains unsupported observation type: ${value}`)
  }
  return value as AgentDebugObservationType
}

function readOptionalBoundedWaitTimeout(row: Record<string, unknown>): number | undefined {
  const value = readOptionalPositiveInteger(row, 'timeoutMs')
  if (value !== undefined && value > MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be at most ${MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS}`)
  }
  return value
}

function readOptionalPositiveInteger(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${key} must be a positive integer`)
  }
  return value
}

function readOptionalNonNegativeInteger(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${key} must be a non-negative integer`)
  }
  return value
}

function readCheckpointScope(value: unknown): RuntimeCheckpointScope {
  const row = readObject(value)
  const eventNames = readOptionalStringArray(row, 'eventNames')
  const fiberNames = readOptionalStringArray(row, 'fiberNames')
  return {
    ...('eventNames' in row ? { eventNames: eventNames! } : {}),
    ...('fiberNames' in row ? { fiberNames: fiberNames! } : {}),
  }
}

function readCheckpoint(row: Record<string, unknown>, key: string): RuntimeCheckpoint {
  const value = row[key]
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${key} must be a RuntimeCheckpoint object`)
  }
  return value as RuntimeCheckpoint
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}
