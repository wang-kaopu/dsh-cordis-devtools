import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { lstat as nodeLstat, readFile as nodeReadFile, rename as nodeRename, unlink as nodeUnlink, writeFile as nodeWriteFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { parseDocument, YAMLMap, YAMLSeq, isMap, isSeq } from 'yaml'
import { readMcpTokenFile, type TokenFileStats, type TokenFileSystem } from './token-store.js'

const PLUGIN_ID = 'dsh-cordis-devtools'
const MCP_PORT = 43127
const TOKEN_FILE_NAME = '.dsh-cordis-devtools-token'
const LOCK_FILE_NAME = '.dsh-cordis-devtools-bootstrap.lock'

/** Minimal metadata required to reject unsafe profile and token paths. */
export interface BootstrapFileStats extends TokenFileStats {
  isDirectory(): boolean
}

/** Filesystem boundary for profile bootstrap operations. */
export interface BootstrapFileSystem extends TokenFileSystem {
  lstat(path: string): Promise<BootstrapFileStats>
  writeFile(path: string, contents: string, options?: { flag?: string; mode?: number }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(path: string): Promise<void>
}

/** Process boundary used to register the bridge without exposing a generated token. */
export type BootstrapSpawner = (command: string, args: readonly string[]) => Promise<void>

/** MCP discovery boundary used by doctor and its deterministic tests. */
export type BootstrapMcpDiscovery = (endpoint: string, token: string) => Promise<readonly string[]>

/** Injectable operations for setup, doctor, and token rotation. */
export interface BootstrapCliOptions {
  env?: NodeJS.ProcessEnv
  /** Platform used for owner-only permission enforcement; defaults to process.platform. */
  platform?: NodeJS.Platform
  files?: BootstrapFileSystem
  spawnCodex?: BootstrapSpawner
  discoverTools?: BootstrapMcpDiscovery
  randomToken?: () => string
}

/** Structured result returned by one bootstrap command. */
export interface BootstrapCliResult {
  value: Record<string, unknown>
}

/** Error raised by profile-scoped bootstrap validation or operations. */
export class BootstrapCliError extends Error {
  readonly code = 'bootstrap-failed'

  constructor(message: string) {
    super(message)
    this.name = 'BootstrapCliError'
  }
}

const nodeFiles: BootstrapFileSystem = {
  lstat: path => nodeLstat(path),
  readFile: path => nodeReadFile(path, 'utf8'),
  writeFile: (path, contents, options) => nodeWriteFile(path, contents, { encoding: 'utf8', ...options }),
  rename: (oldPath, newPath) => nodeRename(oldPath, newPath),
  unlink: path => nodeUnlink(path),
}

/** Returns whether argv begins with one of the three profile bootstrap commands. */
export function isBootstrapCommand(args: readonly string[]): boolean {
  return args[0] === 'setup' || args[0] === 'doctor' || args[0] === 'rotate-token'
}

/**
 * Executes one explicit profile-scoped bootstrap command.
 *
 * @param args - Arguments after the executable name.
 * @param options - Environment, filesystem, process, and MCP seams.
 * @returns A secret-free structured result suitable for CLI JSON output.
 */
export async function runBootstrapCli(args: readonly string[], options: BootstrapCliOptions = {}): Promise<BootstrapCliResult> {
  const command = parseBootstrapArgs(args)
  const profile = resolveProfile(command.profile, options.env ?? process.env)
  const files = options.files ?? nodeFiles
  if (command.kind === 'doctor') return { value: await doctorProfile(profile, { ...options, files }) }
  return withProfileLock(profile, files, async () => {
    if (command.kind === 'setup') {
      return { value: await setupProfile(profile, options) }
    }
    if (command.kind === 'doctor') {
      return { value: await doctorProfile(profile, options) }
    }
    return { value: await rotateProfile(profile, options) }
  })
}

interface BootstrapCommand {
  kind: 'setup' | 'doctor' | 'rotate-token'
  profile: string
  agent?: 'codex'
}

interface ProfilePaths {
  name: string
  dshHome: string
  profilesDir: string
  profileDir: string
  patchPath: string
  tokenPath: string
  lockPath: string
}

/** Parses the restricted syntax shared by all profile bootstrap commands. */
function parseBootstrapArgs(args: readonly string[]): BootstrapCommand {
  const kind = args[0]
  if (kind !== 'setup' && kind !== 'doctor' && kind !== 'rotate-token') throw new BootstrapCliError('unknown bootstrap command')
  let profile: string | undefined
  let agent: 'codex' | undefined
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (value === undefined || value.startsWith('-')) throw new BootstrapCliError(`${flag} requires a value`)
    if (flag === '--profile') {
      if (profile !== undefined) throw new BootstrapCliError('--profile may be supplied only once')
      profile = value
    } else if (flag === '--agent' && kind === 'setup') {
      if (agent !== undefined) throw new BootstrapCliError('--agent may be supplied only once')
      if (value !== 'codex') throw new BootstrapCliError('--agent must be codex')
      agent = 'codex'
    } else {
      throw new BootstrapCliError(`unknown ${kind} option: ${flag}`)
    }
    index += 1
  }
  if (profile === undefined) throw new BootstrapCliError(`${kind} requires --profile`)
  if (kind === 'setup' && agent === undefined) throw new BootstrapCliError('setup requires --agent codex')
  if (kind !== 'setup' && agent !== undefined) throw new BootstrapCliError(`${kind} does not accept --agent`)
  return { kind, profile, ...(agent === undefined ? {} : { agent }) }
}

/** Resolves and validates one profile beneath the configured DSH home. */
function resolveProfile(name: string, env: NodeJS.ProcessEnv): ProfilePaths {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) || name === '.' || name === '..') throw new BootstrapCliError('profile must be one safe path segment')
  const dshHome = resolve(env.DSH_HOME ?? join(homedir(), '.dsh'))
  const profilesDir = join(dshHome, 'profiles')
  const profileDir = join(profilesDir, name)
  if (normalize(profileDir) !== profileDir || !profileDir.startsWith(`${normalize(profilesDir)}${'/'}`)) throw new BootstrapCliError('profile path is outside DSH profiles')
  return {
    name,
    dshHome,
    profilesDir,
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    tokenPath: join(profileDir, TOKEN_FILE_NAME),
    lockPath: join(profileDir, LOCK_FILE_NAME),
  }
}

/** Serializes mutating profile operations with an exclusive lock file. */
async function withProfileLock<T>(profile: ProfilePaths, files: BootstrapFileSystem, operation: () => Promise<T>): Promise<T> {
  await assertDirectory(profile.profileDir, files)
  try {
    await files.writeFile(profile.lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 })
  } catch {
    throw new BootstrapCliError('profile bootstrap is already locked or unavailable')
  }
  try {
    return await operation()
  } finally {
    try { await files.unlink(profile.lockPath) } catch { /* preserve the operation result; lock cleanup is best effort */ }
  }
}

/** Creates the token and applies the profile patch before registering Codex. */
async function setupProfile(profile: ProfilePaths, options: BootstrapCliOptions): Promise<Record<string, unknown>> {
  const files = options.files ?? nodeFiles
  assertSecurePlatform(options.platform ?? process.platform)
  await assertRegular(profile.patchPath, files, false)
  await assertTokenTarget(profile.tokenPath, files)
  let token: string
  try { token = options.randomToken?.() ?? generateToken() } catch { throw new BootstrapCliError('MCP token generation failed') }
  if (token.trim().length === 0) throw new BootstrapCliError('generated MCP token was empty')
  await writeTokenAtomically(profile.tokenPath, token, files)
  await updatePatch(profile, files)
  try {
    await (options.spawnCodex ?? spawnCodex)(
      'codex',
      ['mcp', 'add', PLUGIN_ID, '--', 'dsh-cordis-devtools-mcp', '--endpoint', `http://127.0.0.1:${MCP_PORT}/mcp`, '--token-file', profile.tokenPath],
    )
  } catch { throw new BootstrapCliError('Codex MCP registration failed') }
  return { command: 'setup', profile: profile.name, tokenFile: profile.tokenPath, endpoint: `http://127.0.0.1:${MCP_PORT}/mcp`, reloadRequired: true }
}

/** Verifies the current profile and performs authenticated MCP tool discovery. */
async function doctorProfile(profile: ProfilePaths, options: BootstrapCliOptions): Promise<Record<string, unknown>> {
  const files = options.files ?? nodeFiles
  await assertDirectory(profile.profileDir, files)
  await assertRegular(profile.patchPath, files, false)
  await assertTokenTarget(profile.tokenPath, files)
  const patch = await readPatch(profile, files)
  if (!patchConfigured(patch, profile.tokenPath)) throw new BootstrapCliError('profile patch does not contain the expected MCP configuration')
  const token = await readMcpTokenFile(profile.tokenPath, files)
  let tools: readonly string[]
  try {
    tools = await (options.discoverTools ?? discoverTools)(`http://127.0.0.1:${MCP_PORT}/mcp`, token)
  } catch {
    throw new BootstrapCliError('MCP endpoint is unavailable or authentication failed')
  }
  return { command: 'doctor', profile: profile.name, endpoint: `http://127.0.0.1:${MCP_PORT}/mcp`, tokenFile: profile.tokenPath, authenticated: true, tools: [...tools] }
}

/** Replaces the token and patch while leaving DSH reload to the user. */
async function rotateProfile(profile: ProfilePaths, options: BootstrapCliOptions): Promise<Record<string, unknown>> {
  const files = options.files ?? nodeFiles
  assertSecurePlatform(options.platform ?? process.platform)
  await assertRegular(profile.patchPath, files, false)
  await assertTokenTarget(profile.tokenPath, files)
  let token: string
  try { token = options.randomToken?.() ?? generateToken() } catch { throw new BootstrapCliError('MCP token generation failed') }
  if (token.trim().length === 0) throw new BootstrapCliError('generated MCP token was empty')
  await writeTokenAtomically(profile.tokenPath, token, files)
  await updatePatch(profile, files)
  return { command: 'rotate-token', profile: profile.name, tokenFile: profile.tokenPath, endpoint: `http://127.0.0.1:${MCP_PORT}/mcp`, reloadRequired: true }
}

/** Fails closed when the platform cannot enforce POSIX owner-only permissions. */
function assertSecurePlatform(platform: NodeJS.Platform): void {
  if (platform !== 'darwin' && platform !== 'linux') throw new BootstrapCliError('token file permissions are unsupported on this platform')
}

/** Confirms that a profile path is an existing non-symlink directory. */
async function assertDirectory(path: string, files: BootstrapFileSystem): Promise<void> {
  let stats: BootstrapFileStats
  try { stats = await files.lstat(path) } catch { throw new BootstrapCliError('DSH profile does not exist') }
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new BootstrapCliError('DSH profile must be a real directory')
}

/** Confirms that a profile file is a regular non-symlink file. */
async function assertRegular(path: string, files: BootstrapFileSystem, allowMissing: boolean): Promise<void> {
  try {
    const stats = await files.lstat(path)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new BootstrapCliError('profile file must be a regular non-symlink file')
  } catch (error) {
    if (allowMissing && isMissingError(error)) return
    if (error instanceof BootstrapCliError) throw error
    throw new BootstrapCliError('profile file is unavailable')
  }
}

/** Confirms an existing token target has owner-only readable permissions. */
async function assertTokenTarget(path: string, files: BootstrapFileSystem): Promise<void> {
  try {
    const stats = await files.lstat(path)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new BootstrapCliError('token file must be a regular non-symlink file')
    if ((stats.mode & 0o077) !== 0 || (stats.mode & 0o400) === 0) throw new BootstrapCliError('token file must be owner-only readable')
  } catch (error) {
    if (error instanceof BootstrapCliError) throw error
    if (isMissingError(error)) return
    throw new BootstrapCliError('token file is unavailable')
  }
}

/** Parses a profile patch while replacing parser errors with safe diagnostics. */
async function readPatch(profile: ProfilePaths, files: BootstrapFileSystem): Promise<ReturnType<typeof parseDocument>> {
  let source: string
  try { source = await files.readFile(profile.patchPath) } catch { throw new BootstrapCliError('profile patch cannot be read') }
  const document = parseDocument(source)
  if (document.errors.length > 0) throw new BootstrapCliError('profile patch is invalid YAML')
  return document
}

/** Updates only the DevTools entry in a top-level sequence patch. */
async function updatePatch(profile: ProfilePaths, files: BootstrapFileSystem): Promise<void> {
  const document = await readPatch(profile, files)
  const contents = document.contents
  if (!isSeq(contents)) throw new BootstrapCliError('profile patch must be a top-level YAML sequence')
  let plugin: YAMLMap | undefined
  for (const item of contents.items) {
    if (isMap(item) && yamlValue(item.get('id', true)) === PLUGIN_ID) {
      if (plugin !== undefined) throw new BootstrapCliError('profile patch contains duplicate DevTools entries')
      plugin = item
    }
  }
  if (plugin === undefined) {
    plugin = new YAMLMap()
    plugin.set('id', PLUGIN_ID)
    contents.items.push(plugin)
  }
  const configValue = plugin.get('config', true)
  const config = configValue === undefined || configValue === null ? new YAMLMap() : configValue
  if (!isMap(config)) throw new BootstrapCliError('DevTools plugin config must be a YAML map')
  plugin.set('config', config)
  const mcpValue = config.get('mcp', true)
  const mcp = mcpValue === undefined || mcpValue === null ? new YAMLMap() : mcpValue
  if (!isMap(mcp)) throw new BootstrapCliError('DevTools MCP config must be a YAML map')
  config.set('mcp', mcp)
  mcp.set('enabled', true)
  mcp.set('port', MCP_PORT)
  mcp.set('failOnStartupError', true)
  mcp.set('tokenFile', profile.tokenPath)
  mcp.delete('token')
  await writePatchAtomically(profile.patchPath, document.toString(), files)
}

/** Checks that a parsed patch matches the settings expected by doctor. */
function patchConfigured(document: ReturnType<typeof parseDocument>, tokenPath: string): boolean {
  if (!isSeq(document.contents)) return false
  const plugin = document.contents.items.find(item => isMap(item) && yamlValue(item.get('id', true)) === PLUGIN_ID)
  if (!isMap(plugin)) return false
  const config = plugin.get('config', true)
  if (!isMap(config)) return false
  const mcp = config.get('mcp', true)
  if (!isMap(mcp)) return false
  return yamlValue(mcp.get('enabled', true)) === true && yamlValue(mcp.get('port', true)) === MCP_PORT && yamlValue(mcp.get('failOnStartupError', true)) === true && yamlValue(mcp.get('tokenFile', true)) === tokenPath && mcp.get('token', true) === undefined
}

/** Returns a YAML scalar's JavaScript value for exact configuration checks. */
function yamlValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'value' in value) return (value as { value: unknown }).value
  return value
}

/** Replaces a profile patch through a private temporary file and atomic rename. */
async function writePatchAtomically(path: string, contents: string, files: BootstrapFileSystem): Promise<void> {
  const temporaryPath = `${path}.${randomBytes(12).toString('hex')}.tmp`
  try {
    await files.writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600 })
    const stats = await files.lstat(temporaryPath)
    if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o077) !== 0 || (stats.mode & 0o400) === 0) throw new BootstrapCliError('temporary profile patch is unsafe')
    await files.rename(temporaryPath, path)
  } catch (error) {
    try { await files.unlink(temporaryPath) } catch { /* cleanup is best effort */ }
    if (error instanceof BootstrapCliError) throw error
    throw new BootstrapCliError('profile patch cannot be written')
  }
}

/** Replaces a token through a private owner-only temporary file and rename. */
async function writeTokenAtomically(path: string, token: string, files: BootstrapFileSystem): Promise<void> {
  const temporaryPath = `${path}.${randomBytes(12).toString('hex')}.tmp`
  try {
    await files.writeFile(temporaryPath, `${token}\n`, { flag: 'wx', mode: 0o600 })
    const stats = await files.lstat(temporaryPath)
    if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o077) !== 0 || (stats.mode & 0o400) === 0) throw new BootstrapCliError('temporary token file is unsafe')
    await assertTokenTarget(path, files)
    await files.rename(temporaryPath, path)
  } catch (error) {
    try { await files.unlink(temporaryPath) } catch { /* cleanup is best effort */ }
    if (error instanceof BootstrapCliError) throw error
    throw new BootstrapCliError('token file cannot be written')
  }
}

/** Generates a cryptographically random URL-safe bearer token. */
function generateToken(): string {
  try { return randomBytes(32).toString('base64url') } catch { throw new BootstrapCliError('MCP token generation failed') }
}

/** Runs the Codex registration command without passing secret material. */
async function spawnCodex(command: string, args: readonly string[]): Promise<void> {
  const { spawn } = await import('node:child_process')
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.once('error', () => reject(new BootstrapCliError('Codex MCP registration failed')))
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new BootstrapCliError('Codex MCP registration failed')))
  })
}

/** Connects to the loopback MCP endpoint and returns discovered tool names. */
async function discoverTools(endpoint: string, token: string): Promise<readonly string[]> {
  const client = new Client({ name: 'dsh-cordis-debug-bootstrap', version: '0.8.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  try {
    await client.connect(transport)
    return (await client.listTools()).tools.map(tool => tool.name)
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** Identifies an ENOENT failure without exposing its original message. */
function isMissingError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}
