import { readFile, writeFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { pathToFileURL } from 'node:url'
import {
  runCliProgram,
  type CliFiles,
  type CliIo,
  type CliProgramDependencies,
  type CliRunResult,
  type ToolClient,
} from './cli/program.js'

const CLIENT_INFO = { name: 'dsh-cordis-debug', version: '0.7.0' } as const

/** Connection settings for the loopback DSH DevTools MCP endpoint. */
export interface CliConnectionConfig {
  /** Streamable HTTP MCP endpoint, restricted to a loopback host. */
  endpoint: string
  /** Bearer token used for every MCP request. */
  token: string
}

/** Result of separating connection flags from the command passed to the CLI program. */
export interface ParsedCliConnectionArgs {
  /** Validated loopback MCP connection settings. */
  config: CliConnectionConfig
  /** Positional command and command-specific options forwarded unchanged. */
  commandArgs: readonly string[]
}

/** Error raised before connecting when CLI connection settings are invalid. */
export class CliConnectionError extends Error {
  /** Stable structured error code for connection configuration failures. */
  readonly code = 'invalid-connection-config'

  constructor(message: string) {
    super(message)
    this.name = 'CliConnectionError'
  }
}

/** Minimal MCP client surface needed by the CLI transport wrapper. */
export interface CliMcpClient {
  connect(transport: Transport): Promise<void>
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

/** Injection seam for constructing the official MCP client and transport. */
export interface CliToolClientFactoryOptions {
  /** Constructs an MCP client; defaults to the official SDK Client. */
  createClient?: () => CliMcpClient
  /** Constructs a transport and receives the fully formed authenticated request options. */
  createTransport?: (endpoint: URL, options: StreamableHTTPClientTransportOptions) => Transport
}

/** Dependencies that keep the process entry point deterministic in tests. */
export interface CliMainOptions {
  /** Environment source; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Output channels; defaults to Node stdout/stderr. */
  io?: CliIo
  /** Filesystem boundary; defaults to `node:fs/promises`. */
  files?: CliFiles
  /** MCP client factory; defaults to `createToolClient`. */
  createClient?: (config: CliConnectionConfig) => Promise<ToolClient>
  /** Program runner; defaults to `runCliProgram`. */
  runProgram?: typeof runCliProgram
  /** Process exit-code sink; defaults to `process.exitCode`. */
  setExitCode?: (exitCode: number) => void
}

/**
 * Parses global connection flags and validates the required loopback MCP config.
 *
 * `--endpoint` and `--token` may be supplied as separate values or with `=`.
 * Environment variables provide fallbacks when the corresponding flag is absent.
 * All other arguments are returned in their original order for `runCliProgram`.
 *
 * @param args - Arguments after the executable name.
 * @param env - Environment source used for fallback values.
 * @returns Validated connection config and command arguments.
 */
export function parseCliConnectionArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCliConnectionArgs {
  let endpoint = env.DSH_CORDIS_DEBUG_ENDPOINT
  let token = env.DSH_CORDIS_DEBUG_TOKEN
  let endpointFlag = false
  let tokenFlag = false
  const commandArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      commandArgs.push(...args.slice(index + 1))
      break
    }
    if (argument === '--endpoint' || argument.startsWith('--endpoint=')) {
      if (endpointFlag) throw new CliConnectionError('--endpoint may be supplied only once')
      endpointFlag = true
      endpoint = argument === '--endpoint' ? requireFlagValue(args, ++index, '--endpoint') : argument.slice('--endpoint='.length)
      continue
    }
    if (argument === '--token' || argument.startsWith('--token=')) {
      if (tokenFlag) throw new CliConnectionError('--token may be supplied only once')
      tokenFlag = true
      token = argument === '--token' ? requireFlagValue(args, ++index, '--token') : argument.slice('--token='.length)
      continue
    }
    commandArgs.push(argument)
  }

  if (endpoint === undefined || endpoint.length === 0) throw new CliConnectionError('MCP endpoint is required via --endpoint or DSH_CORDIS_DEBUG_ENDPOINT')
  if (token === undefined || token.length === 0) throw new CliConnectionError('MCP token is required via --token or DSH_CORDIS_DEBUG_TOKEN')
  const validatedEndpoint = validateEndpoint(endpoint)
  return { config: { endpoint: validatedEndpoint, token }, commandArgs }
}

/** Alias that makes the global-flag purpose explicit to embedders. */
export const parseGlobalConnectionArgs = parseCliConnectionArgs

/**
 * Creates and connects the official MCP Streamable HTTP client for one invocation.
 *
 * @param config - Validated loopback endpoint and bearer token.
 * @param options - Optional construction seam for deterministic tests.
 * @returns A `ToolClient` compatible with the command program.
 */
export async function createToolClient(
  config: CliConnectionConfig,
  options: CliToolClientFactoryOptions = {},
): Promise<ToolClient> {
  const endpoint = validateEndpoint(config.endpoint)
  if (config.token.length === 0) throw new CliConnectionError('MCP token must not be empty')
  const transportOptions: StreamableHTTPClientTransportOptions = {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  }
  const transport: Transport = options.createTransport === undefined
    ? new StreamableHTTPClientTransport(new URL(endpoint), transportOptions)
    : options.createTransport(new URL(endpoint), transportOptions)
  const client: CliMcpClient = options.createClient === undefined
    ? new Client(CLIENT_INFO, { capabilities: {} })
    : options.createClient()
  await client.connect(transport)
  return {
    callTool: async (name, params = {}) => client.callTool({ name, arguments: params }),
    close: () => client.close(),
  }
}

/**
 * Runs the process entry point without calling `process.exit`, making it safe to embed and test.
 *
 * @param argv - Arguments after the executable name; defaults to `process.argv.slice(2)`.
 * @param options - Injectable environment, IO, filesystem, client, and exit-code boundaries.
 * @returns The structured command result and exit code.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  options: CliMainOptions = {},
): Promise<CliRunResult> {
  const io = options.io ?? nodeIo()
  const files = options.files ?? nodeFiles()
  const setExitCode = options.setExitCode ?? ((exitCode: number) => { process.exitCode = exitCode })
  let config: CliConnectionConfig
  let commandArgs: readonly string[]
  try {
    ({ config, commandArgs } = parseCliConnectionArgs(argv, options.env ?? process.env))
  } catch (error) {
    const result = connectionFailure(error)
    await io.writeStderr(`${JSON.stringify({ error: result.error })}\n`)
    setExitCode(result.exitCode)
    return result
  }

  const protectedIo = redactIo(io, config.token)
  try {
    const client = await (options.createClient ?? (value => createToolClient(value)))(config)
    const dependencies: CliProgramDependencies = { client, io: protectedIo, files }
    const result = await (options.runProgram ?? runCliProgram)(commandArgs, dependencies)
    setExitCode(result.exitCode)
    return result
  } catch (error) {
    const result = connectionFailure(error, config.token, 'command-failed')
    await protectedIo.writeStderr(`${JSON.stringify({ error: result.error })}\n`)
    setExitCode(result.exitCode)
    return result
  }
}

function requireFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index]
  if (value === undefined || value === '--' || value.startsWith('--')) throw new CliConnectionError(`${flag} requires a value`)
  return value
}

function validateEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliConnectionError('MCP endpoint must be a valid http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CliConnectionError('MCP endpoint must use http or https')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) throw new CliConnectionError('MCP endpoint must be loopback-only: use localhost, 127.0.0.1, or [::1]')
  if (url.username !== '' || url.password !== '') throw new CliConnectionError('MCP endpoint must not include credentials')
  return url.toString()
}

function connectionFailure(error: unknown, token?: string, fallbackCode = 'invalid-connection-config'): CliRunResult {
  const message = redact(error instanceof Error ? error.message : String(error), token)
  const code = error instanceof CliConnectionError ? error.code : fallbackCode
  return { exitCode: 1, error: { code, message } }
}

function redact(value: string, token?: string): string {
  return token === undefined || token.length === 0 ? value : value.split(token).join('[REDACTED]')
}

function redactIo(io: CliIo, token: string): CliIo {
  return {
    writeStdout: text => io.writeStdout(redact(text, token)),
    writeStderr: text => io.writeStderr(redact(text, token)),
  }
}

function nodeIo(): CliIo {
  return {
    writeStdout: text => { process.stdout.write(text) },
    writeStderr: text => { process.stderr.write(text) },
  }
}

function nodeFiles(): CliFiles {
  return {
    readFile: path => readFile(path, 'utf8'),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    void error
    process.stderr.write('{"error":{"code":"command-failed","message":"CLI entry failed"}}\n')
    process.exitCode = 1
  })
}
