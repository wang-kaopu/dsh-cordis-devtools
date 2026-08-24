import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { RuntimeDiagnosticsQuery } from './diagnostics.js'

export const DEFAULT_MCP_PORT = 43127
export const MCP_PATH = '/mcp'

const MAX_BODY_BYTES = 1024 * 1024
const MCP_SERVER_INFO = { name: 'dsh-cordis-devtools', version: '0.4.0' } as const

export interface EmbeddedMcpOptions {
  port?: number
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
  limit: { type: 'number', description: 'Maximum returned traces, 1 through 100.' },
})

const TOOLS: Tool[] = [
  tool('cordis_runtime_summary', 'Return compact live Cordis counts and bounded evidence-window metadata.', EMPTY_SCHEMA),
  tool('cordis_inspect_event', 'Inspect current live listener registrations for one exact Cordis event.', EVENT_SCHEMA),
  tool('cordis_inspect_fiber', 'Inspect one live Fiber uid or all live Fibers with one exact name.', FIBER_SCHEMA),
  tool('cordis_search_dispatches', 'Search the retained bounded observer dispatch window newest-first.', DISPATCH_SCHEMA),
  tool('cordis_profiler_traces', 'Read existing retained waterfall profiler traces without enabling instrumentation.', PROFILER_SCHEMA),
]

export async function startEmbeddedMcpServer(
  diagnostics: RuntimeDiagnosticsQuery,
  options: EmbeddedMcpOptions = {},
): Promise<EmbeddedMcpHandle> {
  const port = normalizePort(options.port ?? DEFAULT_MCP_PORT)
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

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid request body' })
      return
    }

    const server = createProtocolServer(diagnostics)
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

function createProtocolServer(diagnostics: RuntimeDiagnosticsQuery): Server {
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
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
          const limit = readOptionalNumber(args, 'limit')
          value = diagnostics.profilerTraces({
            ...(event === undefined ? {} : { event }),
            ...(limit === undefined ? {} : { limit }),
          })
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

function tool(name: string, description: string, inputSchema: Tool['inputSchema']): Tool {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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

function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}
