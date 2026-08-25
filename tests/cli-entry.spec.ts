import { describe, expect, it } from 'vitest'
import {
  CliConnectionError,
  createToolClient,
  main,
  parseCliConnectionArgs,
  type CliMcpClient,
} from '../src/cli.js'
import type { CliIo, ToolClient } from '../src/cli/program.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

function memoryIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  const io: CliIo = {
    writeStdout: text => { stdout.push(text) },
    writeStderr: text => { stderr.push(text) },
  }
  return { io, stdout, stderr }
}

describe('DSH debug CLI entry', () => {
  it('parses flags, applies environment fallbacks, and forwards command arguments', () => {
    expect(parseCliConnectionArgs(
      ['--endpoint', 'http://127.0.0.1:43127/mcp', '--token=flag-token', 'watch', '--event', 'demo/event'],
      { DSH_CORDIS_DEBUG_TOKEN: 'env-token' },
    )).toEqual({
      config: { endpoint: 'http://127.0.0.1:43127/mcp', token: 'flag-token' },
      commandArgs: ['watch', '--event', 'demo/event'],
    })

    expect(parseCliConnectionArgs(
      ['targets'],
      { DSH_CORDIS_DEBUG_ENDPOINT: 'https://localhost:43127/mcp', DSH_CORDIS_DEBUG_TOKEN: 'env-token' },
    )).toEqual({
      config: { endpoint: 'https://localhost:43127/mcp', token: 'env-token' },
      commandArgs: ['targets'],
    })
  })

  it('requires a complete config and rejects non-loopback endpoints', () => {
    expect(() => parseCliConnectionArgs(['targets'], {})).toThrow(CliConnectionError)
    expect(() => parseCliConnectionArgs(
      ['--endpoint', 'https://example.com/mcp', '--token', 'secret', 'targets'],
      {},
    )).toThrow('loopback')
    expect(() => parseCliConnectionArgs(
      ['--endpoint', 'file:///tmp/mcp', '--token', 'secret', 'targets'],
      {},
    )).toThrow('http or https')
  })

  it('uses the official MCP shape and puts the token only in the Authorization header', async () => {
    let seenOptions: StreamableHTTPClientTransportOptions | undefined
    let seenCall: unknown
    const mcpClient: CliMcpClient = {
      async connect() {},
      async callTool(params) {
        seenCall = params
        return { structuredContent: { ok: true } }
      },
      async close() {},
    }
    const toolClient = await createToolClient(
      { endpoint: 'http://localhost:43127/mcp', token: 'super-secret' },
      {
        createTransport: (endpoint, options) => {
          expect(endpoint.toString()).toBe('http://localhost:43127/mcp')
          seenOptions = options
          return {} as Transport
        },
        createClient: () => mcpClient,
      },
    )
    await expect(toolClient.callTool('cordis_runtime_summary', { limit: 1 })).resolves.toEqual({ structuredContent: { ok: true } })
    expect(seenCall).toEqual({ name: 'cordis_runtime_summary', arguments: { limit: 1 } })
    expect(seenOptions).toMatchObject({ requestInit: { headers: { Authorization: 'Bearer super-secret' } } })
  })

  it('forwards command arguments and never writes the bearer token', async () => {
    const { io, stdout, stderr } = memoryIo()
    const forwarded: string[][] = []
    const exitCodes: number[] = []
    const client: ToolClient = { async callTool() { return {} }, async close() {} }
    const result = await main(
      ['--endpoint=http://127.0.0.1:43127/mcp', '--token', 'super-secret', 'snapshot'],
      {
        io,
        createClient: async () => client,
        runProgram: async (args, dependencies) => {
          forwarded.push([...args])
          await dependencies.io.writeStdout('{"token":"super-secret"}\n')
          await dependencies.io.writeStderr('failure: super-secret\n')
          return { exitCode: 0, value: { token: 'super-secret' } }
        },
        setExitCode: code => { exitCodes.push(code) },
      },
    )
    expect(result.exitCode).toBe(0)
    expect(forwarded).toEqual([['snapshot']])
    expect(stdout.join('')).not.toContain('super-secret')
    expect(stderr.join('')).not.toContain('super-secret')
    expect(exitCodes).toEqual([0])
  })

  it('returns a structured config error without creating a client', async () => {
    const { io, stderr } = memoryIo()
    const exitCodes: number[] = []
    let created = false
    const result = await main(['targets'], {
      io,
      createClient: async () => {
        created = true
        return { async callTool() { return {} }, async close() {} }
      },
      setExitCode: code => { exitCodes.push(code) },
    })
    expect(result).toMatchObject({ exitCode: 1, error: { code: 'invalid-connection-config' } })
    expect(created).toBe(false)
    expect(JSON.parse(stderr[0])).toEqual({ error: result.error })
    expect(exitCodes).toEqual([1])
  })
})
