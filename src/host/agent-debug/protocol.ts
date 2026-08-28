import type {
  AgentDebugCatalogInput,
  AgentDebugSessionDetail,
  AgentDebugSessionId,
  AgentDebugSnapshotInput,
  AgentDebugSnapshotSection,
} from '../../shared/agent-debug.js'
import {
  DEVTOOLS_PROTOCOL_DESCRIPTION,
  isProtocolMethod,
  observationTypeForProtocolEvent,
  projectDevtoolsProtocolEvent,
  protocolDomainForEvent,
  type DevtoolsProtocolCommandRequest,
  type DevtoolsProtocolDomainName,
  type DevtoolsProtocolErrorCode,
  type DevtoolsProtocolEvent,
  type DevtoolsProtocolReadEventsInput,
  type DevtoolsProtocolReadEventsResult,
  type DevtoolsProtocolResponse,
  type DevtoolsProtocolWaitForEventInput,
  type DevtoolsProtocolWaitForEventResult,
} from '../../shared/devtools-protocol.js'
import type { WaterfallExperimentStartInput } from '../../shared/experiments.js'
import type { RuntimeDiagnosticsQuery } from '../diagnostics.js'
import { AgentDebugService } from './service.js'

/** Optional authorization hook for mutation commands in a transport adapter. */
export interface AgentDebugProtocolSendOptions {
  allowExperimentMutation?: boolean
}

/** Transport-neutral protocol router over the unique Agent Debug Core. */
export class AgentDebugProtocol {
  constructor(
    private readonly debug: AgentDebugService,
    private readonly diagnostics: RuntimeDiagnosticsQuery,
  ) {}

  /** Returns the single machine-readable protocol schema. */
  getProtocol(): typeof DEVTOOLS_PROTOCOL_DESCRIPTION {
    return DEVTOOLS_PROTOCOL_DESCRIPTION
  }

  /** Lists active target metadata through the existing target registry. */
  listTargets() {
    return this.debug.listTargets()
  }

  /** Attaches a session to the exact target incarnation. */
  attach(targetId: string): AgentDebugSessionDetail {
    return this.debug.attachDebugSession(targetId)
  }

  /** Detaches the exact session and releases its Core-owned resources. */
  detach(sessionId: AgentDebugSessionId): AgentDebugSessionDetail | null {
    return this.debug.detachDebugSession(sessionId)
  }

  /** Routes one generic protocol command without creating another runtime owner. */
  send(request: DevtoolsProtocolCommandRequest, options: AgentDebugProtocolSendOptions = {}): DevtoolsProtocolResponse {
    const sessionId = request.sessionId
    const id = request.id
    if (!isProtocolMethod(request.method)) return this.error(id, 'unknown_method', 'Unknown DSH Agent Debug protocol method', sessionId)
    try {
      const params = readObject(request.params)
      switch (request.method) {
        case 'Schema.getDomains':
          return { id, result: this.getProtocol() }
        case 'Target.getTargets':
          return { id, result: { targets: this.listTargets() } }
        case 'Target.attachToTarget':
          return { id, result: this.attach(readRequiredString(params, 'targetId')) }
        case 'Target.detachFromTarget':
          return { id, result: this.requireDetached(sessionId) ?? this.fail('session_not_found', 'Agent Debug session was not found', sessionId) }
        case 'Cordis.enable':
          return { id, result: this.enable(sessionId, 'Cordis') }
        case 'Cordis.disable':
          return { id, result: this.enable(sessionId, 'Cordis', false) }
        case 'Cordis.getSnapshot':
          return { id, result: this.debug.debugSnapshot({ debugSessionId: this.requireActiveSessionId(sessionId), ...readSnapshotParams(params) }), sessionId }
        case 'Cordis.getEvent':
          this.requireActiveSessionId(sessionId)
          return { id, result: this.diagnostics.inspectEvent(readRequiredString(params, 'name')), sessionId }
        case 'Cordis.getListeners': {
          this.requireActiveSessionId(sessionId)
          const inspection = this.diagnostics.inspectEvent(readRequiredString(params, 'name'))
          return { id, result: { generatedAt: inspection.generatedAt, name: inspection.name, found: inspection.found, listeners: inspection.listeners }, sessionId }
        }
        case 'Cordis.searchDispatches':
          this.requireActiveSessionId(sessionId)
          return { id, result: this.diagnostics.searchDispatches({ ...readOptionalStringParam(params, 'event'), ...readOptionalNumberParam(params, 'fiberUid'), ...readOptionalStringParam(params, 'mode'), ...readOptionalNumberParam(params, 'limit') }), sessionId }
        case 'Fiber.list': {
          const snapshot = this.debug.debugSnapshot({ debugSessionId: this.requireSessionId(sessionId), sections: ['fibers'], catalogs: { fibers: readCatalogInput(params.catalog) } })
          return { id, result: { eventCursor: snapshot.eventCursor, fibers: snapshot.fibers }, sessionId }
        }
        case 'Fiber.get':
          this.requireActiveSessionId(sessionId)
          return { id, result: this.diagnostics.inspectFiber(readFiberSelector(params)), sessionId }
        case 'Profiler.enableEvents':
          return { id, result: this.enable(sessionId, 'Profiler') }
        case 'Profiler.disableEvents':
          return { id, result: this.enable(sessionId, 'Profiler', false) }
        case 'Profiler.getStatus':
          this.requireActiveSessionId(sessionId)
          return { id, result: this.diagnostics.waterfallExperimentStatus(), sessionId }
        case 'Profiler.getTraces':
          this.requireActiveSessionId(sessionId)
          return { id, result: this.diagnostics.profilerTraces({ ...readOptionalStringParam(params, 'event'), ...readOptionalStringParam(params, 'experimentId'), ...readOptionalNumberParam(params, 'limit') }), sessionId }
        case 'Profiler.startExperiment':
          if (!options.allowExperimentMutation) return this.error(id, 'not_authorized', 'Profiler experiment mutation is not authorized', sessionId)
          return { id, result: this.debug.startAgent(this.requireActiveSessionId(sessionId), 'mcp', readStartInput(params)), sessionId }
        case 'Profiler.stopExperiment':
          if (!options.allowExperimentMutation) return this.error(id, 'not_authorized', 'Profiler experiment mutation is not authorized', sessionId)
          return { id, result: this.debug.stopAgent(this.requireActiveSessionId(sessionId), { leaseId: readRequiredString(params, 'leaseId') }), sessionId }
      }
    } catch (error) {
      return this.errorFor(error, id, sessionId)
    }
  }

  /** Reads retained metadata-only protocol events after a session cursor. */
  readEvents(input: DevtoolsProtocolReadEventsInput): DevtoolsProtocolReadEventsResult {
    const type = input.method === undefined ? undefined : observationTypeForProtocolEvent(input.method)
    if (input.method !== undefined && type === undefined) throw new ProtocolRequestError('invalid_params', 'Unknown protocol event filter')
    const result = this.debug.readObservations({ debugSessionId: input.debugSessionId, afterSequence: input.afterSequence, type, event: input.event })
    const events = result.observations
      .map(observation => projectDevtoolsProtocolEvent(observation, input.debugSessionId))
      .filter(event => this.isDeliverable(input.debugSessionId, event))
      .filter(event => input.method === undefined || event.method === input.method)
    return { outcome: result.window.gap ? 'gap' : 'ok', events, window: result.window, session: result.session }
  }

  /** Waits for one subscribed protocol event while preserving Core cancellation semantics. */
  async waitForEvent(input: DevtoolsProtocolWaitForEventInput, signal?: AbortSignal): Promise<DevtoolsProtocolWaitForEventResult> {
    const type = input.method === undefined ? undefined : observationTypeForProtocolEvent(input.method)
    if (input.method !== undefined && type === undefined) throw new ProtocolRequestError('invalid_params', 'Unknown protocol event filter')
    if (input.method !== undefined && !this.debug.isEventDomainEnabled(input.debugSessionId, protocolDomainForEvent(input.method))) {
      const current = this.debug.readObservations({ debugSessionId: input.debugSessionId, afterSequence: input.afterSequence, type, event: input.event })
      return { outcome: current.window.gap ? 'gap' : 'timeout', event: null, window: current.window, session: current.session }
    }
    const result = await this.debug.waitForRuntimeChange({ debugSessionId: input.debugSessionId, afterSequence: input.afterSequence, type, event: input.event, timeoutMs: input.timeoutMs }, signal)
    const event = result.outcome === 'found' && result.observation !== null
      ? projectDevtoolsProtocolEvent(result.observation, input.debugSessionId)
      : null
    return { outcome: result.outcome, event, window: result.window, session: result.session }
  }

  private enable(sessionId: AgentDebugSessionId | undefined, domain: DevtoolsProtocolDomainName, enabled = true): { enabled: boolean; domain: DevtoolsProtocolDomainName; session: AgentDebugSessionDetail } {
    const id = this.requireActiveSessionId(sessionId)
    const session = this.debug.setEventDomainEnabled(id, domain, enabled)
    return { enabled: session.status === 'active' && enabled, domain, session }
  }

  private isDeliverable(sessionId: AgentDebugSessionId, event: DevtoolsProtocolEvent): boolean {
    return this.debug.isEventDomainEnabled(sessionId, protocolDomainForEvent(event.method))
  }

  private requireDetached(sessionId: AgentDebugSessionId | undefined): AgentDebugSessionDetail | null {
    const id = this.requireSessionId(sessionId)
    return this.detach(id)
  }

  private requireSessionId(sessionId: AgentDebugSessionId | undefined): AgentDebugSessionId {
    if (sessionId === undefined || sessionId.trim() === '') throw new ProtocolRequestError('invalid_params', 'Session-scoped protocol command requires sessionId')
    return sessionId
  }

  private requireActiveSessionId(sessionId: AgentDebugSessionId | undefined): AgentDebugSessionId {
    const id = this.requireSessionId(sessionId)
    this.debug.assertActiveSession(id)
    return id
  }

  private error(id: number, code: DevtoolsProtocolErrorCode, message: string, sessionId?: AgentDebugSessionId, data?: Readonly<Record<string, unknown>>) {
    return { id, error: { code, message, ...(data === undefined ? {} : { data }) }, ...(sessionId === undefined ? {} : { sessionId }) }
  }

  private fail(code: DevtoolsProtocolErrorCode, message: string, sessionId?: AgentDebugSessionId): never {
    throw new ProtocolRequestError(code, message)
  }

  private errorFor(error: unknown, id: number, sessionId?: AgentDebugSessionId) {
    if (error instanceof ProtocolRequestError) return this.error(id, error.code, error.message, sessionId, error.data)
    const message = error instanceof Error ? error.message : ''
    if (message.includes('unknown or inactive Agent Debug target')) return this.error(id, 'target_not_found', 'Agent Debug target was not found or is inactive', sessionId)
    if (message.includes('unknown Agent Debug session')) return this.error(id, 'session_not_found', 'Agent Debug session was not found', sessionId)
    if (message.includes('stale or inactive')) return this.error(id, 'session_stale', 'Agent Debug session is stale or inactive', sessionId)
    if (message.includes('cursor') || message.includes('waiters')) return this.error(id, 'resource_limit', 'Agent Debug bounded resource limit was exceeded', sessionId)
    if (message.includes('experiment') || message.includes('waterfall')) return this.error(id, 'not_authorized', 'Profiler experiment operation is unavailable', sessionId)
    if (error instanceof RangeError || error instanceof TypeError) return this.error(id, 'invalid_params', 'Protocol parameters are invalid', sessionId)
    return this.error(id, 'internal_error', 'DSH Agent Debug protocol command failed', sessionId)
  }
}

/** Error carrying a safe stable protocol code to the adapter boundary. */
export class ProtocolRequestError extends Error {
  constructor(readonly code: DevtoolsProtocolErrorCode, message: string, readonly data?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = 'ProtocolRequestError'
  }
}

/** Validates and narrows a protocol params object. */
function readObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new ProtocolRequestError('invalid_params', 'Protocol params must be an object')
  return value as Record<string, unknown>
}

/** Reads one required non-empty string parameter. */
function readRequiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.trim() === '') throw new ProtocolRequestError('invalid_params', `${key} must be a non-empty string`)
  return field
}

/** Reads one optional string parameter while preserving the source key. */
function readOptionalStringParam(value: Record<string, unknown>, key: string): Record<string, string> {
  const field = value[key]
  if (field === undefined) return {}
  return { [key]: readRequiredString(value, key) }
}

/** Reads one optional finite numeric parameter while preserving the source key. */
function readOptionalNumberParam(value: Record<string, unknown>, key: string): Record<string, number> {
  const field = value[key]
  if (field === undefined) return {}
  if (typeof field !== 'number' || !Number.isFinite(field)) throw new ProtocolRequestError('invalid_params', `${key} must be a finite number`)
  return { [key]: field }
}

/** Reads the mutually exclusive uid/name selector for Fiber.get. */
function readFiberSelector(value: Record<string, unknown>) {
  const hasUid = value.uid !== undefined
  const hasName = value.name !== undefined
  if (hasUid === hasName) throw new ProtocolRequestError('invalid_params', 'Fiber.get requires exactly one of uid or name')
  if (hasUid) return { uid: readOptionalNumberParam(value, 'uid').uid }
  return { name: readRequiredString(value, 'name') }
}

/** Reads the bounded finite experiment TTL input. */
function readStartInput(value: Record<string, unknown>): WaterfallExperimentStartInput {
  const ttlMs = value.ttlMs
  if (ttlMs === undefined) return {}
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new ProtocolRequestError('invalid_params', 'ttlMs must be a positive finite number')
  return { ttlMs }
}

/** Reads one optional bounded catalog page input. */
function readCatalogInput(value: unknown): AgentDebugCatalogInput | undefined {
  if (value === undefined) return undefined
  const objectValue = readObject(value)
  const limit = objectValue.limit === undefined ? undefined : readOptionalNumberParam(objectValue, 'limit').limit
  const cursor = objectValue.cursor === undefined ? undefined : readRequiredString(objectValue, 'cursor')
  return { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) }
}

/** Reads optional snapshot sections and catalog pages from command params. */
function readSnapshotParams(value: Record<string, unknown>): Pick<{ sections?: readonly AgentDebugSnapshotSection[]; catalogs?: AgentDebugSnapshotInput['catalogs'] }, 'sections' | 'catalogs'> {
  const sectionsValue = value.sections
  const sections = sectionsValue === undefined ? undefined : readSections(sectionsValue)
  const catalogsValue = value.catalogs
  const catalogs = catalogsValue === undefined ? undefined : readCatalogs(catalogsValue)
  return { ...(sections === undefined ? {} : { sections }), ...(catalogs === undefined ? {} : { catalogs }) }
}

/** Validates the unique set of requested snapshot sections. */
function readSections(value: unknown): readonly AgentDebugSnapshotSection[] {
  if (!Array.isArray(value) || value.some(section => typeof section !== 'string')) throw new ProtocolRequestError('invalid_params', 'sections must be an array of known snapshot sections')
  const known = ['summary', 'events', 'fibers', 'dispatches', 'profiler', 'candidates'] as const
  if (new Set(value).size !== value.length || value.some(section => !(known as readonly string[]).includes(section))) throw new ProtocolRequestError('invalid_params', 'sections contains an unknown or duplicate snapshot section')
  return value as AgentDebugSnapshotSection[]
}

/** Validates catalog page selections for snapshot commands. */
function readCatalogs(value: unknown): AgentDebugSnapshotInput['catalogs'] {
  const objectValue = readObject(value)
  const result: AgentDebugSnapshotInput['catalogs'] = {}
  for (const section of ['events', 'fibers', 'dispatches', 'candidates'] as const) {
    if (objectValue[section] !== undefined) result[section] = readCatalogInput(objectValue[section])
  }
  return result
}
