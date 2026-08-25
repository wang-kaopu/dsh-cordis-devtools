import type {
  AgentDebugSnapshotSection,
  AgentDebugTarget,
} from '../shared/agent-debug.js'

/** The tool transport used by the CLI; transports own authentication details. */
export interface ToolClient {
  /** Calls one named DSH DevTools tool with JSON-compatible arguments. */
  callTool(name: string, params?: Record<string, unknown>): Promise<unknown>
  /** Closes the underlying transport and releases its connection resources. */
  close(): Promise<void>
}

/** Output channels used by the CLI program. */
export interface CliIo {
  /** Writes one already-formatted JSON record to standard output. */
  writeStdout(text: string): void | Promise<void>
  /** Writes one already-formatted JSON error record to standard error. */
  writeStderr(text: string): void | Promise<void>
}

/** File operations used only by checkpoint persistence and comparison. */
export interface CliFiles {
  /** Reads a UTF-8 checkpoint file. */
  readFile(path: string): string | Promise<string>
  /** Writes a UTF-8 checkpoint file. */
  writeFile(path: string, contents: string): void | Promise<void>
}

/** Parsed CLI command union. */
export type CliCommand =
  | { kind: 'targets' }
  | { kind: 'snapshot' }
  | { kind: 'event'; name: string }
  | { kind: 'fiber'; selector: { uid: number } | { name: string } }
  | { kind: 'watch'; event?: string; timeoutMs?: number }
  | { kind: 'checkpoint'; output?: string }
  | { kind: 'compare'; baseline: string }
  | { kind: 'profile'; ttlMs: number }

/** Structured, machine-readable failure returned by the CLI. */
export interface CliError {
  code: string
  message: string
  command?: string
  details?: unknown
}

/** Result returned by the program after writing its JSON output. */
export interface CliRunResult {
  exitCode: number
  value?: unknown
  error?: CliError
}

/** Dependencies required to run one CLI invocation. */
export interface CliProgramDependencies {
  client: ToolClient
  io: CliIo
  files: CliFiles
}

/** Error raised for invalid command-line syntax. */
export class CliArgumentError extends Error {
  /** Stable structured error code for parser failures. */
  readonly code = 'invalid-arguments'

  constructor(message: string) {
    super(message)
    this.name = 'CliArgumentError'
  }
}

const SNAPSHOT_SECTIONS: readonly AgentDebugSnapshotSection[] = [
  'summary',
  'events',
  'fibers',
  'dispatches',
  'profiler',
  'candidates',
]

const TOOL = {
  listTargets: 'cordis_list_debug_targets',
  attach: 'cordis_attach_debug_session',
  snapshot: 'cordis_debug_snapshot',
  wait: 'cordis_wait_for_runtime_change',
  detach: 'cordis_detach_debug_session',
  inspectEvent: 'cordis_inspect_event',
  inspectFiber: 'cordis_inspect_fiber',
  checkpoint: 'cordis_capture_checkpoint',
  compare: 'cordis_compare_current',
  startProfile: 'cordis_start_waterfall_experiment',
  stopProfile: 'cordis_stop_waterfall_experiment',
} as const

/**
 * Parses the positional CLI arguments without touching a transport or filesystem.
 *
 * @param args - Arguments after the executable name.
 * @returns A validated command object.
 */
export function parseCliArgs(args: readonly string[]): CliCommand {
  const [name, ...rest] = args
  if (name === undefined) throw new CliArgumentError('a command is required')
  switch (name) {
    case 'targets':
      requireNoArgs(name, rest)
      return { kind: 'targets' }
    case 'snapshot':
      requireNoArgs(name, rest)
      return { kind: 'snapshot' }
    case 'event':
      if (rest.length !== 1 || rest[0].startsWith('-')) throw new CliArgumentError('event requires exactly one event name')
      return { kind: 'event', name: rest[0] }
    case 'fiber':
      return { kind: 'fiber', selector: parseFiberArgs(rest) }
    case 'watch':
      return { kind: 'watch', ...parseWatchArgs(rest) }
    case 'checkpoint':
      return { kind: 'checkpoint', ...parseCheckpointArgs(rest) }
    case 'compare':
      return { kind: 'compare', baseline: parseRequiredPath(name, rest, '--baseline') }
    case 'profile':
      return { kind: 'profile', ttlMs: parseRequiredInteger(name, rest, '--ttl', true) }
    default:
      throw new CliArgumentError(`unknown command: ${name}`)
  }
}

/**
 * Runs one command, serializing exactly one JSON result or structured error.
 * The client is always closed, including argument and command failures.
 *
 * @param args - Arguments after the executable name.
 * @param dependencies - Injected transport, output, and filesystem boundaries.
 * @returns The process-style exit status and structured result.
 */
export async function runCliProgram(
  args: readonly string[],
  dependencies: CliProgramDependencies,
): Promise<CliRunResult> {
  let result: CliRunResult
  try {
    const command = parseCliArgs(args)
    const value = await executeCommand(command, dependencies.client, dependencies.files)
    await dependencies.io.writeStdout(`${JSON.stringify(value)}\n`)
    result = { exitCode: 0, value }
  } catch (error) {
    const structured = toCliError(error)
    await dependencies.io.writeStderr(`${JSON.stringify({ error: structured })}\n`)
    result = { exitCode: 1, error: structured }
  }

  try {
    await dependencies.client.close()
  } catch (error) {
    if (result.exitCode === 0) {
      const structured = toCliError(error, 'client-close-failed')
      await dependencies.io.writeStderr(`${JSON.stringify({ error: structured })}\n`)
      return { exitCode: 1, error: structured }
    }
  }
  return result
}

async function executeCommand(command: CliCommand, client: ToolClient, files: CliFiles): Promise<unknown> {
  switch (command.kind) {
    case 'targets':
      return call(client, TOOL.listTargets)
    case 'snapshot':
      return withTransientSession(client, async debugSessionId => call(client, TOOL.snapshot, {
        debugSessionId,
        sections: SNAPSHOT_SECTIONS,
      }))
    case 'event':
      return call(client, TOOL.inspectEvent, { name: command.name })
    case 'fiber':
      return call(client, TOOL.inspectFiber, command.selector)
    case 'watch':
      return withTransientSession(client, async debugSessionId => call(client, TOOL.wait, {
        debugSessionId,
        ...(command.event === undefined ? {} : { event: command.event }),
        ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
      }))
    case 'checkpoint': {
      const checkpoint = await call(client, TOOL.checkpoint)
      if (command.output !== undefined) await files.writeFile(command.output, `${JSON.stringify(checkpoint)}\n`)
      return checkpoint
    }
    case 'compare': {
      const contents = await files.readFile(command.baseline)
      let baseline: unknown
      try {
        baseline = JSON.parse(contents)
      } catch (error) {
        throw new CliCommandError('invalid-baseline', `baseline file is not valid JSON: ${command.baseline}`, error)
      }
      return call(client, TOOL.compare, { baseline })
    }
    case 'profile':
      return withTransientSession(client, debugSessionId => runProfile(client, debugSessionId, command.ttlMs))
  }
}

async function runProfile(client: ToolClient, debugSessionId: string, ttlMs: number): Promise<unknown> {
  const start = await call(client, TOOL.startProfile, { debugSessionId, ttlMs })
  const leaseId = startedLeaseId(start)
  if (leaseId === null) return start
  let stop: unknown
  try {
    // There is no reproduction callback in the one-shot CLI command. Keep the
    // lease lifetime bounded to this invocation and always stop the exact lease.
  } finally {
    stop = await call(client, TOOL.stopProfile, { debugSessionId, leaseId })
  }
  return { start, stop }
}

async function withTransientSession<T>(client: ToolClient, action: (debugSessionId: string) => Promise<T>): Promise<T> {
  const listed = await call(client, TOOL.listTargets)
  const target = selectActiveTarget(listed)
  const attached = await call(client, TOOL.attach, {
    targetId: target.targetId,
  })
  const debugSessionId = readDebugSessionId(attached)
  let outcome: T | undefined
  let failure: unknown
  try {
    outcome = await action(debugSessionId)
  } catch (error) {
    failure = error
  }

  try {
    await call(client, TOOL.detach, { debugSessionId })
  } catch (error) {
    if (failure === undefined) throw new CliCommandError('detach-failed', 'failed to detach debug session', error)
  }
  if (failure !== undefined) throw failure
  return outcome as T
}

async function call(client: ToolClient, name: string, arguments_: Record<string, unknown> = {}): Promise<any> {
  const response = await client.callTool(name, arguments_)
  if (isRecord(response) && isToolError(response)) throw new CliCommandError('tool-failed', readToolError(response), response)
  if (isRecord(response) && 'structuredContent' in response && response.structuredContent !== undefined) return response.structuredContent
  if (isRecord(response) && Array.isArray(response.content)) {
    const text = response.content.find(value => isRecord(value) && value.type === 'text' && typeof value.text === 'string')
    if (text && typeof text.text === 'string') {
      try { return JSON.parse(text.text) } catch { return text.text }
    }
  }
  return response
}

function selectActiveTarget(value: unknown): AgentDebugTarget {
  const targets = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.targets) ? value.targets
      : isRecord(value) && isRecord(value.structuredContent) && Array.isArray(value.structuredContent.targets) ? value.structuredContent.targets
        : []
  const active = targets.filter(isActiveCordisTarget)
  if (active.length === 0) throw new CliCommandError('no-active-target', 'no active cordis-runtime target is available')
  if (active.length > 1) throw new CliCommandError('ambiguous-target', 'multiple active cordis-runtime targets are available')
  return active[0] as AgentDebugTarget
}

function isActiveCordisTarget(value: unknown): value is AgentDebugTarget {
  return isRecord(value) && value.status === 'active' && value.type === 'cordis-runtime'
    && typeof value.targetId === 'string' && Number.isInteger(value.targetEpoch)
}

function readDebugSessionId(value: unknown): string {
  const session = isRecord(value) && isRecord(value.session) ? value.session : value
  if (isRecord(session) && typeof session.debugSessionId === 'string') return session.debugSessionId
  throw new CliCommandError('invalid-session', 'attach tool did not return a debugSessionId', value)
}

function startedLeaseId(value: unknown): string | null {
  if (!isRecord(value) || value.outcome !== 'started') return null
  const lease = isRecord(value.lease) ? value.lease : null
  if (lease && typeof lease.leaseId === 'string') return lease.leaseId
  throw new CliCommandError('invalid-lease', 'profile start reported started without an exact leaseId', value)
}

function parseFiberArgs(args: readonly string[]): { uid: number } | { name: string } {
  if (args.length !== 2) throw new CliArgumentError('fiber requires exactly one of --uid N or --name N')
  const [flag, value] = args
  if (value.length === 0 || value.startsWith('-')) throw new CliArgumentError('fiber selector requires a non-empty value')
  if (flag === '--uid') return { uid: parseIntegerValue(value, 'uid', true) }
  if (flag === '--name') return { name: value }
  throw new CliArgumentError('fiber requires exactly one of --uid N or --name N')
}

function parseWatchArgs(args: readonly string[]): { event?: string; timeoutMs?: number } {
  let event: string | undefined
  let timeoutMs: number | undefined
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (value === undefined || value.startsWith('-')) throw new CliArgumentError(`${flag} requires a value`)
    if (flag === '--event') {
      if (event !== undefined) throw new CliArgumentError('watch accepts --event at most once')
      event = value
    } else if (flag === '--timeout') {
      if (timeoutMs !== undefined) throw new CliArgumentError('watch accepts --timeout at most once')
      timeoutMs = parseIntegerValue(value, 'timeout', false)
    } else {
      throw new CliArgumentError(`unknown watch option: ${flag}`)
    }
  }
  return { ...(event === undefined ? {} : { event }), ...(timeoutMs === undefined ? {} : { timeoutMs }) }
}

function parseCheckpointArgs(args: readonly string[]): { output?: string } {
  if (args.length === 0) return {}
  return { output: parseRequiredPath('checkpoint', args, '--output') }
}

function parseRequiredPath(command: string, args: readonly string[], flag: string): string {
  if (args.length !== 2 || args[0] !== flag || args[1].length === 0 || args[1].startsWith('-')) {
    throw new CliArgumentError(`${command} requires ${flag} file`)
  }
  return args[1]
}

function parseRequiredInteger(command: string, args: readonly string[], flag: string, positive: boolean): number {
  if (args.length !== 2 || args[0] !== flag) throw new CliArgumentError(`${command} requires ${flag} ms`)
  return parseIntegerValue(args[1], flag.slice(2), positive)
}

function parseIntegerValue(value: string, label: string, positive: boolean): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new CliArgumentError(`${label} must be a non-negative integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (positive && number <= 0)) {
    throw new CliArgumentError(`${label} must be a ${positive ? 'positive' : 'non-negative'} integer`)
  }
  return number
}

function requireNoArgs(command: string, args: readonly string[]): void {
  if (args.length > 0) throw new CliArgumentError(`${command} does not accept arguments`)
}

function toCliError(error: unknown, fallbackCode = 'command-failed'): CliError {
  if (error instanceof CliCommandError) return { code: error.code, message: error.message, details: error.details }
  if (error instanceof CliArgumentError) return { code: error.code, message: error.message }
  return { code: fallbackCode, message: error instanceof Error ? error.message : String(error) }
}

class CliCommandError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'CliCommandError'
  }
}

function isToolError(value: unknown): boolean {
  return isRecord(value) && value.isError === true
}

function readToolError(value: Record<string, unknown>): string {
  if (typeof value.error === 'string') return value.error
  if (Array.isArray(value.content)) {
    const text = value.content.find(item => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
    if (text && typeof text.text === 'string') return text.text
  }
  return 'DSH DevTools tool failed'
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
