import type { Readable, Writable } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import {
  BridgeConfigurationError,
  type BridgeConnectionConfig,
  type BridgeTokenFileSystem,
  readBridgeTokenFile,
  validateLoopbackEndpoint,
} from './config.js'

const BRIDGE_SERVER_INFO = { name: 'dsh-cordis-devtools-mcp', version: '0.8.0' } as const

/** Minimal remote MCP client surface used by the bridge forwarding layer. */
export interface BridgeRemoteClient {
  connect(transport: Transport): Promise<void>
  listTools(): Promise<ListToolsResult>
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<CallToolResult>
  close(): Promise<void>
}

/** Factory seam for tests and alternate MCP client construction. */
export interface BridgeRemoteFactoryOptions {
  /** Construct an MCP client; defaults to the official SDK Client. */
  createClient?: () => BridgeRemoteClient
  /** Construct an HTTP transport; receives the authenticated request options. */
  createTransport?: (endpoint: URL, options: StreamableHTTPClientTransportOptions) => Transport
}

/** Inputs for creating a bridge server. */
export interface BridgeServerOptions extends BridgeRemoteFactoryOptions {
  /** Connection settings for the DSH MCP endpoint. */
  config: BridgeConnectionConfig
  /** Token-file filesystem seam. */
  files?: BridgeTokenFileSystem
  /** Local server transport seam; defaults to SDK StdioServerTransport. */
  transport?: Transport
  /** Stdio input stream used by the default transport. */
  stdin?: Readable
  /** Stdio output stream used by the default transport. */
  stdout?: Writable
}

/** Handle for a running local stdio bridge. */
export interface BridgeServerHandle {
  /** SDK server instance serving the local Agent connection. */
  server: Server
  /** Transport used by the local Agent connection. */
  transport: Transport
  /** Close local and remote resources. */
  close(): Promise<void>
}

/** Stable error returned when the bridge cannot reach the configured DSH MCP server. */
export class BridgeRemoteError extends Error {
  /** Machine-readable error code suitable for MCP clients. */
  readonly code = 'remote-mcp-unavailable'

  constructor(message = 'DSH DevTools MCP is unavailable; check that DSH is running and the endpoint is reachable') {
    super(message)
    this.name = 'BridgeRemoteError'
  }
}

/**
 * Create and start a stdio MCP bridge that lazily connects to DSH.
 *
 * The bridge has no target/session state. Every tool request is forwarded to
 * the currently configured DSH MCP endpoint after the first request loads and
 * validates the token file.
 *
 * @param options - Endpoint, token-file, transport, and test seams.
 * @returns A running bridge handle.
 */
export async function startBridgeServer(options: BridgeServerOptions): Promise<BridgeServerHandle> {
  const config = normalizeBridgeConfig(options.config)
  const remote = new BridgeRemoteConnection(config, options)
  const server = createBridgeServer(remote)
  const transport = options.transport ?? new StdioServerTransport(options.stdin, options.stdout)
  try {
    await server.connect(transport)
  } catch (error) {
    await remote.close()
    throw new BridgeRemoteError(sanitizeErrorMessage(error))
  }
  return {
    server,
    transport,
    async close() {
      await Promise.allSettled([server.close(), remote.close()])
    },
  }
}

/**
 * Construct the protocol server and lazy forwarding handlers.
 *
 * @param remote - Lazy remote connection used by ListTools and CallTool.
 * @returns An SDK MCP server ready to connect to a local transport.
 */
export function createBridgeServer(remote: BridgeRemoteConnection): Server {
  const server = new Server(BRIDGE_SERVER_INFO, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return remote.redact(await remote.listTools())
    } catch (error) {
      throw asBridgeError(error)
    }
  })
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const args = request.params.arguments
      return remote.redact(await remote.callTool({ name: request.params.name, ...(args === undefined ? {} : { arguments: args }) }))
    } catch (error) {
      const failure = asBridgeError(error)
      return {
        content: [{ type: 'text', text: failure.message }],
        isError: true,
      }
    }
  })
  return server
}

/** Public lazy connection type used for deterministic protocol tests. */
export class BridgeRemoteConnection {
  private token: string | undefined
  private readonly config: BridgeConnectionConfig
  private readonly files: BridgeTokenFileSystem | undefined
  private readonly factory: BridgeRemoteFactoryOptions
  private connectionPromise: Promise<BridgeRemoteClient> | undefined

  /**
   * Create a lazy connection without opening network resources.
   *
   * @param config - Validated loopback endpoint and token file.
   * @param options - Token filesystem and client/transport seams.
   */
  constructor(config: BridgeConnectionConfig, options: Pick<BridgeServerOptions, 'files' | 'createClient' | 'createTransport'> = {}) {
    this.config = normalizeBridgeConfig(config)
    this.files = options.files
    this.factory = options
  }

  /**
   * Forward tools/list after lazily connecting to DSH.
   *
   * @returns The remote tools/list response unchanged except token redaction.
   */
  async listTools(): Promise<ListToolsResult> {
    const client = await this.client()
    try {
      return await client.listTools()
    } catch (error) {
      await this.invalidate(client)
      throw error
    }
  }

  /**
   * Forward tools/call after lazily connecting to DSH.
   *
   * @param params - Remote tool name and arguments.
   * @returns The remote tools/call response.
   */
  async callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<CallToolResult> {
    const client = await this.client()
    try {
      return await client.callTool(params)
    } catch (error) {
      await this.invalidate(client)
      throw error
    }
  }

  /** Redact the private bearer token from values crossing the local MCP boundary. */
  redact<T>(value: T): T {
    return redactMcpResult(value, this.token)
  }

  /** Close the lazy remote connection if it was opened. */
  async close(): Promise<void> {
    if (this.connectionPromise === undefined) return
    await Promise.allSettled([this.connectionPromise.then(client => client.close())])
    this.connectionPromise = undefined
    this.token = undefined
  }

  private async client(): Promise<BridgeRemoteClient> {
    if (this.connectionPromise === undefined) {
      this.connectionPromise = this.connect().catch(error => {
        this.connectionPromise = undefined
        this.token = undefined
        throw asBridgeError(error)
      })
    }
    return this.connectionPromise
  }

  private async invalidate(client: BridgeRemoteClient): Promise<void> {
    // Clear state before awaiting close so a subsequent independent request
    // cannot reuse a transport that already reported a remote failure.
    this.connectionPromise = undefined
    this.token = undefined
    await Promise.allSettled([client.close()])
  }

  private async connect(): Promise<BridgeRemoteClient> {
    const token = await readBridgeTokenFile(this.config.tokenFile, this.files)
    this.token = token
    const transportOptions: StreamableHTTPClientTransportOptions = {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }
    const transport = this.factory.createTransport === undefined
      ? new StreamableHTTPClientTransport(new URL(this.config.endpoint), transportOptions)
      : this.factory.createTransport(new URL(this.config.endpoint), transportOptions)
    const client: BridgeRemoteClient = this.factory.createClient === undefined
      ? new Client(BRIDGE_SERVER_INFO, { capabilities: {} }) as unknown as BridgeRemoteClient
      : this.factory.createClient()
    try {
      await client.connect(transport)
      return client
    } catch (error) {
      await Promise.allSettled([client.close(), transport.close()])
      throw new BridgeRemoteError(sanitizeErrorMessage(error))
    }
  }
}

function normalizeBridgeConfig(config: BridgeConnectionConfig): BridgeConnectionConfig {
  if (typeof config.tokenFile !== 'string' || config.tokenFile.length === 0) throw new BridgeConfigurationError('MCP token file is required')
  return { endpoint: validateLoopbackEndpoint(config.endpoint), tokenFile: config.tokenFile }
}

function asBridgeError(error: unknown): BridgeConfigurationError | BridgeRemoteError {
  if (error instanceof BridgeConfigurationError || error instanceof BridgeRemoteError) return error
  return new BridgeRemoteError()
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof BridgeConfigurationError) return error.message
  return 'DSH DevTools MCP is unavailable; check that DSH is running and the endpoint is reachable'
}

function redactMcpResult<T>(value: T, token: string | undefined): T {
  if (token === undefined) return value
  return redactUnknown(value, token) as T
}

function redactUnknown(value: unknown, token: string): unknown {
  if (typeof value === 'string') return value.split(token).join('[REDACTED]')
  if (Array.isArray(value)) return value.map(item => redactUnknown(item, token))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) result[key] = redactUnknown(item, token)
    return result
  }
  return value
}
