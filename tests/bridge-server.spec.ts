import { mkdtemp, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeDiagnosticsQuery } from '../src/host/diagnostics.js'
import { startEmbeddedMcpServer, type EmbeddedMcpHandle } from '../src/host/mcp.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'
import { parseBridgeConnectionArgs, readBridgeTokenFile } from '../src/bridge/config.js'
import { startBridgeServer, type BridgeRemoteClient, type BridgeServerHandle } from '../src/bridge/server.js'

const handles: Array<EmbeddedMcpHandle | BridgeServerHandle> = []
const clients: Client[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map(client => client.close()))
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
  await Promise.allSettled(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function diagnostics(): RuntimeDiagnosticsQuery {
  const observer: DevtoolsSnapshot = { generatedAt: 1, events: [], listeners: [], fibers: [], dispatches: [] }
  const profiler: WaterfallProfilerSnapshot = { generatedAt: 1, instrumentation: 'disabled', traces: [] }
  return new RuntimeDiagnosticsQuery({ snapshot: () => observer, profilerSnapshot: () => profiler })
}

async function tokenFile(token = 'bridge-secret'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-cordis-bridge-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'token')
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  return path
}

async function connectBridge(endpoint: string, tokenPath: string): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const bridge = await startBridgeServer({ config: { endpoint, tokenFile: tokenPath }, transport: serverTransport })
  handles.push(bridge)
  const client = new Client({ name: 'bridge-test-client', version: '1.0.0' })
  clients.push(client)
  await client.connect(clientTransport)
  return client
}

describe('DSH DevTools stdio bridge', () => {
  it('lazily connects and transparently forwards tools/list and tools/call', async () => {
    const tokenPath = await tokenFile()
    const remote = await startEmbeddedMcpServer(diagnostics(), { port: 0, token: 'bridge-secret' })
    handles.push(remote)
    const client = await connectBridge(remote.url, tokenPath)

    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name)).toContain('cordis_runtime_summary')
    const result = await client.callTool({ name: 'cordis_runtime_summary', arguments: {} })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ events: 0, listeners: 0, liveFibers: 0 })
  })

  it('returns a stable redacted MCP error when DSH is unavailable', async () => {
    const token = 'bridge-secret'
    const tokenPath = await tokenFile(token)
    const client = await connectBridge('http://127.0.0.1:1/mcp', tokenPath)

    await expect(client.listTools()).rejects.toThrow('DSH DevTools MCP is unavailable')
    try {
      await client.listTools()
    } catch (error) {
      expect(String(error)).not.toContain(token)
    }
  })

  it('rejects token paths that are empty or symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-cordis-bridge-invalid-'))
    temporaryDirectories.push(directory)
    const emptyPath = join(directory, 'empty')
    await writeFile(emptyPath, '', { mode: 0o600 })
    await expect(readBridgeTokenFile(emptyPath)).rejects.toThrow('non-empty')

    const targetPath = join(directory, 'target')
    const linkPath = join(directory, 'link')
    await writeFile(targetPath, 'secret', { mode: 0o600 })
    await symlink(targetPath, linkPath)
    await expect(readBridgeTokenFile(linkPath)).rejects.toThrow('symlink')
  })

  it('requires a loopback endpoint and a token-file path, never a token value', () => {
    expect(() => parseBridgeConnectionArgs(['--endpoint', 'https://example.com/mcp', '--token-file', '/tmp/token'])).toThrow('loopback')
    expect(() => parseBridgeConnectionArgs(['--token', 'secret'], { DSH_CORDIS_DEBUG_TOKEN: 'secret' })).toThrow('unknown bridge option')
    expect(() => parseBridgeConnectionArgs([], { DSH_CORDIS_DEBUG_ENDPOINT: 'http://127.0.0.1:43127/mcp' })).toThrow('token file')
  })

  it('does not create a remote transport before the first tool request', async () => {
    const tokenPath = await tokenFile()
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    let transportCreates = 0
    const bridge = await startBridgeServer({
      config: { endpoint: 'http://127.0.0.1:1/mcp', tokenFile: tokenPath },
      transport: serverTransport,
      createTransport: () => {
        transportCreates += 1
        throw new Error('transport should only be created after a request')
      },
    })
    handles.push(bridge)
    const client = new Client({ name: 'bridge-lazy-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(clientTransport)
    expect(transportCreates).toBe(0)
    await expect(client.listTools()).rejects.toThrow('DSH DevTools MCP is unavailable')
    expect(transportCreates).toBe(1)
  })

  it('invalidates a failed remote client and reloads the token on the next request', async () => {
    const tokenPath = await tokenFile('old-secret')
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const authorizationHeaders: string[] = []
    let clientsCreated = 0
    const remoteClient = (): BridgeRemoteClient => {
      clientsCreated += 1
      const ordinal = clientsCreated
      return {
        connect: async () => {},
        listTools: async () => {
          if (ordinal === 1) throw new Error('remote stream failed')
          return { tools: [{ name: 'forwarded_tool', description: 'test', inputSchema: { type: 'object' } }] }
        },
        callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        close: async () => {},
      }
    }
    const bridge = await startBridgeServer({
      config: { endpoint: 'http://127.0.0.1:43127/mcp', tokenFile: tokenPath },
      transport: serverTransport,
      createClient: remoteClient,
      createTransport: (_endpoint, options): Transport => {
        const headers = options.requestInit?.headers
        authorizationHeaders.push(new Headers(headers).get('Authorization') ?? '')
        return { start: async () => {}, send: async () => {}, close: async () => {} }
      },
    })
    handles.push(bridge)
    const client = new Client({ name: 'bridge-rotation-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(clientTransport)

    await expect(client.listTools()).rejects.toThrow('DSH DevTools MCP is unavailable')
    await writeFile(tokenPath, 'new-secret\n', { mode: 0o600 })
    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name)).toEqual(['forwarded_tool'])
    expect(authorizationHeaders).toEqual(['Bearer old-secret', 'Bearer new-secret'])
  })
})
