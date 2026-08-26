import { pathToFileURL } from 'node:url'
import {
  BridgeConfigurationError,
  parseBridgeConnectionArgs,
} from './bridge/config.js'
import { startBridgeServer } from './bridge/server.js'

/**
 * Start the stdio bridge process using endpoint and token-file configuration.
 *
 * @param argv - Arguments after the executable name.
 * @param env - Environment source used for endpoint/path fallbacks.
 * @returns A running bridge handle; the process remains alive while stdio is open.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Awaited<ReturnType<typeof startBridgeServer>>> {
  const config = parseBridgeConnectionArgs(argv, env)
  return startBridgeServer({ config })
}

function writeFailure(error: unknown): void {
  const message = error instanceof BridgeConfigurationError
    ? error.message
    : 'DSH DevTools MCP bridge failed to start; check its endpoint and token-file configuration'
  process.stderr.write(`${JSON.stringify({ error: { code: error instanceof BridgeConfigurationError ? error.code : 'bridge-start-failed', message } })}\n`)
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(writeFailure)
}
