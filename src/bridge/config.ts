import { isAbsolute } from 'node:path'
import {
  McpTokenFileError,
  readMcpTokenFile,
  type TokenFileSystem,
} from '../bootstrap/token-store.js'

/** Validated settings used by the stdio bridge to reach DSH. */
export interface BridgeConnectionConfig {
  /** Loopback Streamable HTTP MCP endpoint exposed by DSH. */
  endpoint: string
  /** Absolute path to the owner-controlled bearer token file. */
  tokenFile: string
}

/** Environment and filesystem inputs used while resolving bridge settings. */
export interface BridgeConfigOptions {
  /** Environment source; defaults to the process environment. */
  env?: NodeJS.ProcessEnv
  /** Filesystem seam for deterministic configuration tests. */
  files?: BridgeTokenFileSystem
}

/** Minimal filesystem surface required for validating and reading a token file. */
export type BridgeTokenFileSystem = TokenFileSystem

/** Stable error raised before a bridge can safely connect to DSH. */
export class BridgeConfigurationError extends Error {
  /** Machine-readable error code suitable for an MCP/CLI boundary. */
  readonly code = 'invalid-bridge-config'

  constructor(message: string) {
    super(message)
    this.name = 'BridgeConfigurationError'
  }
}

/**
 * Parse the bridge's endpoint and token-file flags.
 *
 * The bearer token itself is intentionally not accepted from either argv or
 * environment variables; only a path to an owner-controlled file is parsed.
 *
 * @param args - Arguments after the bridge executable name.
 * @param env - Environment source used for endpoint/path fallbacks.
 * @returns Validated loopback connection settings.
 */
export function parseBridgeConnectionArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): BridgeConnectionConfig {
  let endpoint = env.DSH_CORDIS_DEBUG_ENDPOINT
  let tokenFile = env.DSH_CORDIS_DEBUG_TOKEN_FILE
  let endpointFlag = false
  let tokenFileFlag = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--endpoint' || argument.startsWith('--endpoint=')) {
      if (endpointFlag) throw new BridgeConfigurationError('--endpoint may be supplied only once')
      endpointFlag = true
      endpoint = argument === '--endpoint' ? requireFlagValue(args, ++index, '--endpoint') : argument.slice('--endpoint='.length)
      continue
    }
    if (argument === '--token-file' || argument.startsWith('--token-file=')) {
      if (tokenFileFlag) throw new BridgeConfigurationError('--token-file may be supplied only once')
      tokenFileFlag = true
      tokenFile = argument === '--token-file' ? requireFlagValue(args, ++index, '--token-file') : argument.slice('--token-file='.length)
      continue
    }
    throw new BridgeConfigurationError(`unknown bridge option: ${argument}`)
  }

  if (endpoint === undefined || endpoint.length === 0) throw new BridgeConfigurationError('MCP endpoint is required via --endpoint or DSH_CORDIS_DEBUG_ENDPOINT')
  if (tokenFile === undefined || tokenFile.length === 0) throw new BridgeConfigurationError('MCP token file is required via --token-file or DSH_CORDIS_DEBUG_TOKEN_FILE')
  if (!isAbsolute(tokenFile)) throw new BridgeConfigurationError('MCP token file must be an absolute path')
  return { endpoint: validateLoopbackEndpoint(endpoint), tokenFile }
}

/**
 * Validate a loopback HTTP(S) MCP endpoint using the same boundary as the CLI.
 *
 * @param value - Candidate endpoint URL.
 * @returns Canonical endpoint URL string.
 */
export function validateLoopbackEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BridgeConfigurationError('MCP endpoint must be a valid http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BridgeConfigurationError('MCP endpoint must use http or https')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) throw new BridgeConfigurationError('MCP endpoint must be loopback-only: use localhost, 127.0.0.1, or [::1]')
  if (url.username !== '' || url.password !== '') throw new BridgeConfigurationError('MCP endpoint must not include credentials')
  return url.toString()
}

/**
 * Validate and read an owner-controlled bearer token file.
 *
 * @param tokenFile - Absolute token-file path.
 * @param files - Optional filesystem seam.
 * @returns Trimmed, non-empty bearer token.
 */
export async function readBridgeTokenFile(
  tokenFile: string,
  files?: BridgeTokenFileSystem,
): Promise<string> {
  try {
    return files === undefined ? await readMcpTokenFile(tokenFile) : await readMcpTokenFile(tokenFile, files)
  } catch (error) {
    if (error instanceof McpTokenFileError) throw new BridgeConfigurationError(error.message)
    throw new BridgeConfigurationError('MCP token file cannot be read; check that it exists and is accessible')
  }
}

function requireFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index]
  if (value === undefined || value === '--' || value.startsWith('--')) throw new BridgeConfigurationError(`${flag} requires a value`)
  return value
}
