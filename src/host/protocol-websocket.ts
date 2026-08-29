import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import { isAuthorized } from './auth.js'
import { AgentDebugWaitCancelledError } from './agent-debug/observation-journal.js'
import { AgentDebugProtocol } from './agent-debug/protocol.js'
import {
  DEVTOOLS_PROTOCOL_DESCRIPTION,
  protocolDomainForEvent,
  type DevtoolsProtocolCommandRequest,
  type DevtoolsProtocolDomainName,
  type DevtoolsProtocolEvent,
  type DevtoolsProtocolErrorCode,
  type DevtoolsProtocolResponse,
} from '../shared/devtools-protocol.js'
import type { AgentDebugSessionDetail, AgentDebugTarget } from '../shared/agent-debug.js'

/** Default loopback port for the optional native protocol adapter. */
export const DEFAULT_PROTOCOL_WEBSOCKET_PORT = 43128

/** Stable close code used when an outbound connection queue overflows. */
export const PROTOCOL_WEBSOCKET_SLOW_CONSUMER_CLOSE_CODE = 4001

/** Stable close code used when the attached target incarnation is stale. */
export const PROTOCOL_WEBSOCKET_TARGET_STALE_CLOSE_CODE = 4002

/** Stable close code used when the retained event journal can no longer provide continuity. */
export const PROTOCOL_WEBSOCKET_EVENT_GAP_CLOSE_CODE = 4003

const SERVER_VERSION = '0.8.0'
const DEFAULT_MAX_QUEUED_MESSAGES = 256
const DEFAULT_MAX_QUEUED_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_INBOUND_MESSAGE_BYTES = 1024 * 1024
const SERVER_SHUTDOWN_CLOSE_CODE = 1001
const SLOW_CONSUMER_CLOSE_REASON = 'outbound queue limit exceeded'
const TARGET_STALE_CLOSE_REASON = 'attached target is stale'
const EVENT_GAP_CLOSE_REASON = 'protocol event journal gap'

/** Options for the independent loopback WebSocket protocol server. */
export interface ProtocolWebSocketOptions {
  /** Bind address. Only loopback addresses are accepted. */
  host?: string
  /** TCP port; zero requests an ephemeral port for programmatic callers. */
  port?: number
  /** Optional bearer token checked on discovery and WebSocket upgrade requests. */
  token?: string
  /** Permit the existing Core's finite profiler mutation commands. Default false. */
  allowExperimentMutation?: boolean
  /** Maximum number of queued outbound JSON messages per connection. */
  maxQueuedMessages?: number
  /** Maximum UTF-8 bytes queued per connection, including the in-flight message. */
  maxQueuedBytes?: number
  /** Maximum accepted inbound WebSocket message size. */
  maxInboundMessageBytes?: number
  /** Reject the owning Fiber/plugin when the listener cannot start. Default false. */
  failOnStartupError?: boolean
}

/** Handle returned by the running native protocol server. */
export interface ProtocolWebSocketHandle {
  /** The configured loopback bind host. */
  readonly host: string
  /** The actual listening TCP port. */
  readonly port: number
  /** HTTP base URL for the discovery endpoints. */
  readonly url: string
  /** Returns the unauthenticated target-scoped WebSocket URL. */
  webSocketUrl(targetId: string): string
  /** Closes connections, sessions, and the independent HTTP listener. */
  close(): Promise<void>
}

interface NormalizedProtocolWebSocketOptions {
  host: LoopbackHost
  port: number
  token: string | undefined
  allowExperimentMutation: boolean
  maxQueuedMessages: number
  maxQueuedBytes: number
  maxInboundMessageBytes: number
}

type LoopbackHost = '127.0.0.1' | 'localhost' | '::1'

interface ProtocolWebSocketConnection {
  readonly closeForServer: () => void
  readonly terminate: () => void
}

interface ProtocolWebSocketQueueItem {
  payload: string
  bytes: number
}

/**
 * Starts an independent loopback HTTP/WebSocket adapter over one Agent Debug
 * Protocol Core. The adapter owns transport state only; target, session,
 * observation, and experiment ownership remain in the supplied Core.
 *
 * @param protocol - The already-composed Host-owned protocol Core.
 * @param options - Loopback, authentication, and bounded transport options.
 * @returns A handle that exposes discovery URLs and owns server shutdown.
 */
export async function startProtocolWebSocketServer(
  protocol: AgentDebugProtocol,
  options: ProtocolWebSocketOptions = {},
): Promise<ProtocolWebSocketHandle> {
  const normalized = normalizeOptions(options)
  const http = createServer((request, response) => {
    handleDiscoveryRequest(request, response, protocol, normalized)
  })
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: normalized.maxInboundMessageBytes,
  })
  const connections = new Set<ProtocolWebSocketConnection>()
  let closing = false

  webSocketServer.on('error', () => {
    // The client receives a safe close; raw library errors must not become a
    // protocol response or a log line containing request-controlled material.
  })

  http.on('upgrade', (request, socket, head) => {
    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    if (!isAuthorized(request, normalized.token)) {
      rejectUpgrade(socket, 401, 'Unauthorized', true)
      return
    }

    const targetId = targetIdFromRequest(request)
    if (targetId === null) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    const target = protocol.listTargets().find(candidate => candidate.targetId === targetId)
    if (target === undefined) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const connection = createConnection(webSocket, protocol, target, normalized)
      connections.add(connection)
      void Promise.resolve().then(async () => {
        await connection.start()
        if (connection.isClosed()) connections.delete(connection)
      }).catch(() => {
        connection.closeForServer()
        connections.delete(connection)
      })
    })
  })

  try {
    await listen(http, normalized.port, normalized.host)
  } catch (error) {
    webSocketServer.close()
    throw safeStartupError(error)
  }

  const address = http.address()
  if (address === null || typeof address === 'string') {
    await closeHttpServer(http)
    webSocketServer.close()
    throw new Error('DSH protocol WebSocket server did not expose a TCP address')
  }
  const actualPort = (address as AddressInfo).port
  const baseUrl = `http://${formatUrlHost(normalized.host)}:${actualPort}`

  return {
    host: normalized.host,
    port: actualPort,
    url: baseUrl,
    webSocketUrl: (targetId) => `${baseUrl.replace('http://', 'ws://')}/devtools/page/${encodeURIComponent(targetId)}`,
    async close() {
      if (closing) return
      closing = true
      for (const connection of [...connections]) connection.closeForServer()
      for (const connection of [...connections]) connection.terminate()
      connections.clear()
      await closeWebSocketServer(webSocketServer)
      await closeHttpServer(http)
    },
  }
}

/**
 * Installs the WebSocket adapter as an effect owned by the supplied Cordis
 * context. Unloading the owning Fiber closes the listener and all sessions.
 *
 * @param ctx - Cordis lifecycle owner for the server.
 * @param protocol - The existing Host-owned Agent Debug Protocol Core.
 * @param options - Loopback, authentication, and bounded transport options.
 */
export async function installProtocolWebSocketServer(
  ctx: Context,
  protocol: AgentDebugProtocol,
  options: ProtocolWebSocketOptions = {},
): Promise<void> {
  await ctx.effect(async () => {
    try {
      const handle = await startProtocolWebSocketServer(protocol, options)
      return () => handle.close()
    } catch (error) {
      if (options.failOnStartupError === true) throw error
      console.error(`[dsh-cordis-devtools] protocol WebSocket adapter failed to start: ${error instanceof Error ? error.message : 'unknown error'}`)
      return () => {}
    }
  }, 'dsh-cordis-devtools: protocol WebSocket adapter')
}

/**
 * Installs the protocol WebSocket adapter under the short composition-layer
 * name used by the package entrypoint.
 *
 * @param ctx - Cordis lifecycle owner for the server.
 * @param protocol - The existing Host-owned Agent Debug Protocol Core.
 * @param options - Loopback, authentication, and bounded transport options.
 */
export async function installProtocolWebSocket(
  ctx: Context,
  protocol: AgentDebugProtocol,
  options: ProtocolWebSocketOptions = {},
): Promise<void> {
  await installProtocolWebSocketServer(ctx, protocol, options)
}

function createConnection(
  webSocket: WebSocket,
  protocol: AgentDebugProtocol,
  target: AgentDebugTarget,
  options: NormalizedProtocolWebSocketOptions,
): ProtocolWebSocketConnection & { start: () => Promise<void>; isClosed: () => boolean } {
  let session: AgentDebugSessionDetail | null = null
  let closed = false
  let started = false
  const abortController = new AbortController()
  const enabledDomains = new Set<DevtoolsProtocolDomainName>(['Target'])
  const queue: ProtocolWebSocketQueueItem[] = []
  let queuedBytes = 0
  let sending = false
  let afterSequence = 0

  const connection: ProtocolWebSocketConnection & { start: () => Promise<void>; isClosed: () => boolean } = {
    start: async () => {
      if (started || closed) return
      started = true
      try {
        session = protocol.attach(target.targetId)
        // Core attach defaults to all event domains for the MCP transport;
        // this adapter deliberately starts with only Target lifecycle events.
        sendCoreCommand(protocol, { id: 0, method: 'Cordis.disable', sessionId: session.debugSessionId })
        sendCoreCommand(protocol, { id: 0, method: 'Profiler.disableEvents', sessionId: session.debugSessionId })
        const barrier = protocol.readEvents({ debugSessionId: session.debugSessionId, afterSequence: session.observationSequence })
        afterSequence = barrier.session.observationSequence

        if (!enqueue({
          method: 'Target.attachedToTarget',
          sessionId: session.debugSessionId,
          params: { target, session },
        })) return

        webSocket.on('message', (data, isBinary) => {
          void handleMessage(data, isBinary)
        })
        webSocket.on('close', () => { void cleanup() })
        webSocket.on('error', () => {
          if (!closed) webSocket.terminate()
        })
        await runEventLoop()
      } catch (error) {
        if (!closed) closeForServer(error instanceof AgentDebugWaitCancelledError ? PROTOCOL_WEBSOCKET_TARGET_STALE_CLOSE_CODE : 1011, error instanceof AgentDebugWaitCancelledError ? TARGET_STALE_CLOSE_REASON : 'protocol connection failed')
      }
    },
    isClosed: () => closed,
    closeForServer: () => {
      if (closed) return
      closed = true
      abortController.abort()
      detachSession()
      webSocket.close(SERVER_SHUTDOWN_CLOSE_CODE, 'server shutting down')
    },
    terminate: () => {
      if (webSocket.readyState !== WebSocket.CLOSED) webSocket.terminate()
    },
  }

  async function handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    if (closed) return
    if (isBinary) {
      closeForServer(1003, 'text messages only')
      return
    }

    let value: unknown
    try {
      value = JSON.parse(rawDataToText(data))
    } catch {
      sendError(0, 'invalid_request', 'Protocol message must be valid JSON')
      return
    }
    const request = parseCommandRequest(value)
    if ('error' in request) {
      sendError(request.id, request.error.code, request.error.message)
      return
    }
    if (request.method === 'Target.attachToTarget') {
      sendError(request.id, 'capability_not_supported', 'Target-scoped WebSocket connections are already attached to one exact target session', request.sessionId)
      return
    }
    if (!acceptsSession(request)) {
      sendError(request.id, 'session_not_found', 'Agent Debug session was not found or is not owned by this connection', request.sessionId)
      return
    }

    let response: DevtoolsProtocolResponse
    try {
      response = protocol.send(request, { allowExperimentMutation: options.allowExperimentMutation })
    } catch {
      sendError(request.id, 'internal_error', 'DSH Agent Debug protocol command failed', request.sessionId)
      return
    }

    updateEnabledDomains(request.method, response)
    enqueue(response)
  }

  function acceptsSession(request: DevtoolsProtocolCommandRequest): boolean {
    if (session === null) return false
    const sessionOptional = request.method === 'Schema.getDomains' || request.method === 'Target.getTargets'
    if (sessionOptional) return request.sessionId === undefined || request.sessionId === session.debugSessionId
    return request.sessionId === session.debugSessionId
  }

  async function runEventLoop(): Promise<void> {
    if (session === null) return
    while (!closed) {
      const currentSessionId = session.debugSessionId
      const result = await protocol.waitForEvent({ debugSessionId: currentSessionId, afterSequence }, abortController.signal)
      if (closed) return
      if (result.outcome === 'found' && result.event !== null) {
        afterSequence = sequenceFromEvent(result.event, afterSequence)
        if (eventIsEnabled(result.event) && !enqueue(result.event)) return
        if (result.event.method === 'Target.targetDestroyed') {
          closeForServer(PROTOCOL_WEBSOCKET_TARGET_STALE_CLOSE_CODE, TARGET_STALE_CLOSE_REASON)
          return
        }
      } else if (result.outcome === 'gap') {
        closeForServer(PROTOCOL_WEBSOCKET_EVENT_GAP_CLOSE_CODE, EVENT_GAP_CLOSE_REASON)
        return
      }
    }
  }

  function eventIsEnabled(event: DevtoolsProtocolEvent): boolean {
    return enabledDomains.has(protocolDomainForEvent(event.method))
  }

  function updateEnabledDomains(method: string, response: DevtoolsProtocolResponse): void {
    if (!('result' in response) || session === null || response.sessionId !== session.debugSessionId) return
    if (method === 'Cordis.enable') enabledDomains.add('Cordis')
    if (method === 'Cordis.disable') enabledDomains.delete('Cordis')
    if (method === 'Profiler.enableEvents') enabledDomains.add('Profiler')
    if (method === 'Profiler.disableEvents') enabledDomains.delete('Profiler')
  }

  function sendError(id: number, code: DevtoolsProtocolErrorCode, message: string, sessionId?: string): void {
    enqueue({ id, error: { code, message }, ...(sessionId === undefined ? {} : { sessionId }) })
  }

  function enqueue(value: unknown): boolean {
    if (closed) return false
    let payload: string
    try {
      payload = JSON.stringify(value)
    } catch {
      sendError(0, 'internal_error', 'Protocol response could not be serialized')
      return false
    }
    const bytes = Buffer.byteLength(payload, 'utf8')
    if (queue.length >= options.maxQueuedMessages || queuedBytes + bytes > options.maxQueuedBytes) {
      closeForServer(PROTOCOL_WEBSOCKET_SLOW_CONSUMER_CLOSE_CODE, SLOW_CONSUMER_CLOSE_REASON)
      return false
    }
    queue.push({ payload, bytes })
    queuedBytes += bytes
    flush()
    return true
  }

  function flush(): void {
    if (closed || sending || queue.length === 0 || webSocket.readyState !== WebSocket.OPEN) return
    sending = true
    const item = queue[0]
    webSocket.send(item.payload, { binary: false }, (error) => {
      queue.shift()
      queuedBytes = Math.max(0, queuedBytes - item.bytes)
      sending = false
      if (error != null) {
        closeForServer(1011, 'protocol connection failed')
        return
      }
      flush()
    })
  }

  function closeForServer(code: number, reason: string): void {
    if (closed) return
    closed = true
    abortController.abort()
    queue.length = 0
    queuedBytes = 0
    detachSession()
    if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) webSocket.close(code, reason)
  }

  function detachSession(): void {
    if (session === null) return
    const sessionId = session.debugSessionId
    session = null
    try { protocol.detach(sessionId) } catch { /* Core teardown is idempotent at this boundary. */ }
  }

  async function cleanup(): Promise<void> {
    if (closed) return
    closed = true
    abortController.abort()
    queue.length = 0
    queuedBytes = 0
    detachSession()
  }

  return connection
}

function sendCoreCommand(protocol: AgentDebugProtocol, request: DevtoolsProtocolCommandRequest): void {
  const response = protocol.send(request)
  if ('error' in response) throw new Error('protocol session initialization failed')
}

function parseCommandRequest(value: unknown): DevtoolsProtocolCommandRequest | { id: number; error: { code: DevtoolsProtocolErrorCode; message: string } } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return { id: 0, error: { code: 'invalid_request', message: 'Protocol message must be an object' } }
  const object = value as Record<string, unknown>
  const id = object.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return { id: 0, error: { code: 'invalid_request', message: 'Protocol request id must be a safe integer' } }
  if (typeof object.method !== 'string' || object.method.trim() === '') return { id, error: { code: 'invalid_request', message: 'Protocol request method must be a non-empty string' } }
  if (object.params !== undefined && (object.params === null || Array.isArray(object.params) || typeof object.params !== 'object')) return { id, error: { code: 'invalid_params', message: 'Protocol params must be an object' } }
  if (object.sessionId !== undefined && (typeof object.sessionId !== 'string' || object.sessionId.trim() === '')) return { id, error: { code: 'invalid_params', message: 'sessionId must be a non-empty string' } }
  return {
    id,
    method: object.method,
    ...(object.params === undefined ? {} : { params: object.params as Readonly<Record<string, unknown>> }),
    ...(object.sessionId === undefined ? {} : { sessionId: object.sessionId }),
  }
}

function sequenceFromEvent(event: DevtoolsProtocolEvent, fallback: number): number {
  const sequence = event.params.sequence
  return typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= fallback ? sequence : fallback
}

function handleDiscoveryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  protocol: AgentDebugProtocol,
  options: NormalizedProtocolWebSocketOptions,
): void {
  if (!isAuthorized(request, options.token)) {
    response.setHeader('WWW-Authenticate', 'Bearer')
    writeJson(response, 401, { error: 'unauthorized' })
    return
  }
  const path = requestPath(request)
  if (request.method !== 'GET') {
    if (path === '/json/version' || path === '/json/list' || path === '/json/protocol') response.setHeader('Allow', 'GET')
    writeJson(response, path.startsWith('/json/') ? 405 : 404, { error: path.startsWith('/json/') ? 'method not allowed' : 'not found' })
    return
  }
  const baseUrl = requestBaseUrl(request, options)
  if (path === '/json/version') {
    writeJson(response, 200, { Browser: `dsh-cordis-devtools/${SERVER_VERSION}`, 'Protocol-Version': `${DEVTOOLS_PROTOCOL_DESCRIPTION.version}.0` })
    return
  }
  if (path === '/json/list') {
    writeJson(response, 200, protocol.listTargets().map(target => targetDiscovery(target, baseUrl)))
    return
  }
  if (path === '/json/protocol') {
    writeJson(response, 200, protocol.getProtocol())
    return
  }
  writeJson(response, 404, { error: 'not found' })
}

function targetDiscovery(target: AgentDebugTarget, baseUrl: string): Record<string, unknown> {
  return {
    id: target.targetId,
    type: target.type,
    title: target.metadata.title,
    description: 'Live DSH/Cordis runtime',
    targetEpoch: target.targetEpoch,
    status: target.status,
    capabilities: target.capabilities,
    webSocketDebuggerUrl: `${baseUrl.replace('http://', 'ws://')}/devtools/page/${encodeURIComponent(target.targetId)}`,
  }
}

function normalizeOptions(options: ProtocolWebSocketOptions): NormalizedProtocolWebSocketOptions {
  const host = options.host ?? '127.0.0.1'
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new RangeError('protocol WebSocket host must be loopback')
  return {
    host,
    port: positiveOrZeroInteger(options.port ?? DEFAULT_PROTOCOL_WEBSOCKET_PORT, 'port', 65_535),
    token: options.token,
    allowExperimentMutation: options.allowExperimentMutation === true,
    maxQueuedMessages: positiveInteger(options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES, 'maxQueuedMessages'),
    maxQueuedBytes: positiveInteger(options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES, 'maxQueuedBytes'),
    maxInboundMessageBytes: positiveInteger(options.maxInboundMessageBytes ?? DEFAULT_MAX_INBOUND_MESSAGE_BYTES, 'maxInboundMessageBytes'),
  }
}

function positiveInteger(value: number, name: string): number {
  return positiveOrZeroInteger(value, name, Number.MAX_SAFE_INTEGER, false)
}

function positiveOrZeroInteger(value: number, name: string, maximum: number, allowZero = true): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) throw new RangeError(`${name} must be a bounded integer`)
  return value
}

function requestPath(request: IncomingMessage): string {
  try { return new URL(request.url ?? '/', 'http://127.0.0.1').pathname } catch { return '/' }
}

function targetIdFromRequest(request: IncomingMessage): string | null {
  const match = requestPath(request).match(/^\/devtools\/page\/([^/]+)$/)
  if (match === null) return null
  try {
    const targetId = decodeURIComponent(match[1])
    return targetId.length === 0 || targetId.includes('/') ? null : targetId
  } catch { return null }
}

function requestBaseUrl(request: IncomingMessage, options: NormalizedProtocolWebSocketOptions): string {
  const port = request.socket.localPort ?? options.port
  return `http://${formatUrlHost(options.host)}:${port}`
}

function formatUrlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return data.toString('utf8')
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string, authenticate = false): void {
  const headers = [`HTTP/1.1 ${statusCode} ${statusText}`, 'Connection: close', 'Content-Length: 0']
  if (authenticate) headers.push('WWW-Authenticate: Bearer')
  socket.write(`${headers.join('\r\n')}\r\n\r\n`)
  socket.destroy()
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise(resolve => {
    if (!server.listening) { resolve(); return }
    server.close(() => resolve())
  })
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

function safeStartupError(error: unknown): Error {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return new Error(`DSH protocol WebSocket server could not start (${error.code})`)
  return new Error('DSH protocol WebSocket server could not start')
}