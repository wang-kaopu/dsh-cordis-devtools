import type {
  AgentDebugObservation,
  AgentDebugObservationWindow,
  AgentDebugSessionDetail,
  AgentDebugSessionId,
} from './agent-debug.js'
import {
  AGENT_DEBUG_CAPABILITIES,
  AGENT_DEBUG_PROTOCOL_NAME,
  AGENT_DEBUG_PROTOCOL_VERSION,
} from './agent-debug.js'

/** JSON values accepted by the transport-neutral protocol envelope. */
export type DevtoolsProtocolJsonValue = string | number | boolean | null | DevtoolsProtocolJsonValue[] | { [key: string]: DevtoolsProtocolJsonValue }

/** Stable machine-readable protocol error vocabulary. */
export const DEVTOOLS_PROTOCOL_ERROR_CODES = [
  'invalid_request',
  'invalid_params',
  'unknown_method',
  'not_authorized',
  'target_not_found',
  'target_stale',
  'session_not_found',
  'session_stale',
  'capability_not_supported',
  'resource_limit',
  'transport_closing',
  'internal_error',
] as const

/** Domains exposed by the first DSH Agent Debug protocol revision. */
export const DEVTOOLS_PROTOCOL_DOMAINS = ['Schema', 'Target', 'Cordis', 'Fiber', 'Profiler'] as const

/** Commands exposed by the first DSH Agent Debug protocol revision. */
export const DEVTOOLS_PROTOCOL_METHODS = [
  'Schema.getDomains',
  'Target.getTargets',
  'Target.attachToTarget',
  'Target.detachFromTarget',
  'Cordis.enable',
  'Cordis.disable',
  'Cordis.getSnapshot',
  'Cordis.getEvent',
  'Cordis.getListeners',
  'Cordis.searchDispatches',
  'Fiber.list',
  'Fiber.get',
  'Profiler.enableEvents',
  'Profiler.disableEvents',
  'Profiler.getStatus',
  'Profiler.getTraces',
  'Profiler.startExperiment',
  'Profiler.stopExperiment',
] as const

/** Events exposed by the first DSH Agent Debug protocol revision. */
export const DEVTOOLS_PROTOCOL_EVENTS = [
  'Target.targetDestroyed',
  'Cordis.dispatchObserved',
  'Cordis.topologyInvalidated',
  'Profiler.traceUpdated',
  'Profiler.statusChanged',
] as const

/** Protocol domain name. */
export type DevtoolsProtocolDomainName = (typeof DEVTOOLS_PROTOCOL_DOMAINS)[number]

/** Protocol command name. */
export type DevtoolsProtocolMethod = (typeof DEVTOOLS_PROTOCOL_METHODS)[number]

/** Protocol event name. */
export type DevtoolsProtocolEventName = (typeof DEVTOOLS_PROTOCOL_EVENTS)[number]

/** Protocol error code. */
export type DevtoolsProtocolErrorCode = (typeof DEVTOOLS_PROTOCOL_ERROR_CODES)[number]

/** JSON-schema-shaped descriptor used for runtime protocol introspection. */
export interface DevtoolsProtocolSchema {
  type: string
  properties?: Readonly<Record<string, DevtoolsProtocolSchema>>
  items?: DevtoolsProtocolSchema
  required?: readonly string[]
  enum?: readonly string[]
  additionalProperties?: boolean
  description?: string
}

/** One command described by Schema.getDomains. */
export interface DevtoolsProtocolCommandDescriptor {
  name: string
  description: string
  sessionRequired: boolean
  params: DevtoolsProtocolSchema
  returns: DevtoolsProtocolSchema
  experimental: boolean
  deprecated: boolean
}

/** One event described by Schema.getDomains. */
export interface DevtoolsProtocolEventDescriptor {
  name: string
  description: string
  sessionRequired: boolean
  params: DevtoolsProtocolSchema
  experimental: boolean
  deprecated: boolean
}

/** One protocol domain described by Schema.getDomains. */
export interface DevtoolsProtocolDomainDescriptor {
  name: DevtoolsProtocolDomainName
  description: string
  commands: readonly DevtoolsProtocolCommandDescriptor[]
  events: readonly DevtoolsProtocolEventDescriptor[]
}

/** Complete machine-readable protocol description. */
export interface DevtoolsProtocolDescription {
  name: 'dsh-devtools-for-agents'
  version: 1
  wire: 'json-command'
  domains: readonly DevtoolsProtocolDomainDescriptor[]
  capabilities: readonly string[]
}

/** Command envelope used by the generic protocol primitive. */
export interface DevtoolsProtocolCommandRequest {
  /** Command id scoped to the adapter connection. */
  id: number
  method: string
  params?: Readonly<Record<string, unknown>>
  sessionId?: AgentDebugSessionId
}

/** Safe protocol error envelope. */
export interface DevtoolsProtocolError {
  code: DevtoolsProtocolErrorCode
  message: string
  data?: Readonly<Record<string, unknown>>
}

/** Successful command response envelope. */
export interface DevtoolsProtocolSuccessResponse<T = unknown> {
  id: number
  result: T
  sessionId?: AgentDebugSessionId
}

/** Failed command response envelope. */
export interface DevtoolsProtocolErrorResponse {
  id: number
  error: DevtoolsProtocolError
  sessionId?: AgentDebugSessionId
}

/** Union of one successful or failed command response envelope. */
export type DevtoolsProtocolResponse<T = unknown> = DevtoolsProtocolSuccessResponse<T> | DevtoolsProtocolErrorResponse

/** One event delivered to a subscribed debug session. */
export interface DevtoolsProtocolEvent {
  method: DevtoolsProtocolEventName
  sessionId: AgentDebugSessionId
  params: Readonly<Record<string, unknown>>
}

/** Filter for reading retained protocol events. */
export interface DevtoolsProtocolEventFilter {
  method?: DevtoolsProtocolEventName
  event?: string
}

/** Input for the bounded read-events primitive. */
export interface DevtoolsProtocolReadEventsInput extends DevtoolsProtocolEventFilter {
  debugSessionId: AgentDebugSessionId
  afterSequence?: number
}

/** Result of reading the bounded protocol event journal. */
export interface DevtoolsProtocolReadEventsResult {
  outcome: 'ok' | 'gap'
  events: readonly DevtoolsProtocolEvent[]
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Input for the bounded wait-events primitive. */
export interface DevtoolsProtocolWaitForEventInput extends DevtoolsProtocolReadEventsInput {
  timeoutMs?: number
}

/** Result of one bounded protocol event wait. */
export interface DevtoolsProtocolWaitForEventResult {
  outcome: 'found' | 'timeout' | 'gap'
  event: DevtoolsProtocolEvent | null
  window: AgentDebugObservationWindow
  session: AgentDebugSessionDetail
}

/** Creates an object-shaped runtime schema descriptor. */
const object = (properties: Readonly<Record<string, DevtoolsProtocolSchema>> = {}, required: readonly string[] = []): DevtoolsProtocolSchema => ({
  type: 'object', properties, required, additionalProperties: false,
})
/** Creates a string-shaped runtime schema descriptor. */
const string = (description?: string): DevtoolsProtocolSchema => ({ type: 'string', ...(description === undefined ? {} : { description }) })
/** Creates a number-shaped runtime schema descriptor. */
const number = (description?: string): DevtoolsProtocolSchema => ({ type: 'number', ...(description === undefined ? {} : { description }) })
/** Creates an array-shaped runtime schema descriptor. */
const array = (items: DevtoolsProtocolSchema): DevtoolsProtocolSchema => ({ type: 'array', items })
const anyObject = object()

const targetId = string('Exact target id returned by Target.getTargets.')
const catalogInput = object({ cursor: string('Session-owned catalog cursor.'), limit: number('Bounded page size, at most 100.') })
const snapshotInput = object({
  sections: array(string('Snapshot section name.')),
  catalogs: anyObject,
})

/** Creates one command descriptor with stable metadata flags. */
function command(name: string, description: string, params: DevtoolsProtocolSchema, returns: DevtoolsProtocolSchema, sessionRequired = false): DevtoolsProtocolCommandDescriptor {
  return { name, description, sessionRequired, params, returns, experimental: false, deprecated: false }
}

/** Creates one event descriptor with stable metadata flags. */
function event(name: string, description: string, params: DevtoolsProtocolSchema, sessionRequired = true): DevtoolsProtocolEventDescriptor {
  return { name, description, sessionRequired, params, experimental: false, deprecated: false }
}

/** The single machine-readable v1 protocol schema exposed to Agents. */
export const DEVTOOLS_PROTOCOL_DESCRIPTION: DevtoolsProtocolDescription = {
  name: AGENT_DEBUG_PROTOCOL_NAME,
  version: AGENT_DEBUG_PROTOCOL_VERSION,
  wire: 'json-command',
  capabilities: [...AGENT_DEBUG_CAPABILITIES],
  domains: [
    {
      name: 'Schema',
      description: 'Runtime protocol introspection.',
      commands: [command('Schema.getDomains', 'Return the complete DSH Agent Debug protocol schema.', object(), anyObject)],
      events: [],
    },
    {
      name: 'Target',
      description: 'Discover and attach to exact Cordis runtime incarnations.',
      commands: [
        command('Target.getTargets', 'List active runtime targets.', object(), anyObject),
        command('Target.attachToTarget', 'Attach to one exact active target.', object({ targetId }, ['targetId']), anyObject),
        command('Target.detachFromTarget', 'Detach one exact debug session.', object(), anyObject, true),
      ],
      events: [event('Target.targetDestroyed', 'The target incarnation can no longer receive requests.', object({ sequence: number(), observedAt: number(), targetId, targetEpoch: number() }))],
    },
    {
      name: 'Cordis',
      description: 'Metadata-only Cordis topology, snapshot, and dispatch evidence.',
      commands: [
        command('Cordis.enable', 'Enable Cordis observation events for this session.', object(), anyObject, true),
        command('Cordis.disable', 'Disable Cordis observation events for this session.', object(), anyObject, true),
        command('Cordis.getSnapshot', 'Return a bounded authoritative runtime snapshot.', snapshotInput, anyObject, true),
        command('Cordis.getEvent', 'Inspect one exact live Event and its listeners.', object({ name: string('Exact live event name.') }, ['name']), anyObject, true),
        command('Cordis.getListeners', 'Inspect listeners for one exact live Event.', object({ name: string('Exact live event name.') }, ['name']), anyObject, true),
        command('Cordis.searchDispatches', 'Search the retained dispatch window newest-first.', object({ event: string(), fiberUid: number(), mode: string(), limit: number() }), anyObject, true),
      ],
      events: [
        event('Cordis.dispatchObserved', 'Pre-execution dispatch metadata; not completion evidence.', object({ sequence: number(), observedAt: number(), dispatchId: number(), event: string(), mode: string(), argCount: number(), registeredListeners: number() })),
        event('Cordis.topologyInvalidated', 'Authoritative topology should be queried again.', object({ sequence: number(), observedAt: number(), reason: string() })),
      ],
    },
    {
      name: 'Fiber',
      description: 'Metadata-only live Fiber inspection.',
      commands: [
        command('Fiber.list', 'Return a bounded page of live Fibers.', object({ catalog: catalogInput }), anyObject, true),
        command('Fiber.get', 'Inspect one exact Fiber uid or name.', object({ uid: number(), name: string() }), anyObject, true),
      ],
      events: [],
    },
    {
      name: 'Profiler',
      description: 'Read retained metadata-only traces and control finite experiments.',
      commands: [
        command('Profiler.enableEvents', 'Enable profiler observation events for this session.', object(), anyObject, true),
        command('Profiler.disableEvents', 'Disable profiler observation events for this session.', object(), anyObject, true),
        command('Profiler.getStatus', 'Read profiler ownership and instrumentation state.', object(), anyObject, true),
        command('Profiler.getTraces', 'Read retained profiler traces.', object({ event: string(), experimentId: string(), limit: number() }), anyObject, true),
        command('Profiler.startExperiment', 'Start one finite, authority-approved profiler lease.', object({ ttlMs: number() }), anyObject, true),
        command('Profiler.stopExperiment', 'Stop only the exact lease owned by this session.', object({ leaseId: string() }, ['leaseId']), anyObject, true),
      ],
      events: [
        event('Profiler.traceUpdated', 'A retained metadata-only trace changed.', object({ sequence: number(), observedAt: number(), traceId: string(), event: string() })),
        event('Profiler.statusChanged', 'Profiler instrumentation ownership or state changed.', object({ sequence: number(), observedAt: number(), instrumentation: string() })),
      ],
    },
  ],
}

/** Protocol event name corresponding to one retained Host observation type. */
export function protocolEventForObservationType(type: AgentDebugObservation['type']): DevtoolsProtocolEventName {
  switch (type) {
    case 'dispatch-observed': return 'Cordis.dispatchObserved'
    case 'topology-invalidated': return 'Cordis.topologyInvalidated'
    case 'profiler-trace-updated': return 'Profiler.traceUpdated'
    case 'profiler-status-changed': return 'Profiler.statusChanged'
    case 'target-disposed': return 'Target.targetDestroyed'
  }
}

/** Observation type corresponding to a protocol event, or undefined for an unknown name. */
export function observationTypeForProtocolEvent(method: string): AgentDebugObservation['type'] | undefined {
  switch (method) {
    case 'Cordis.dispatchObserved': return 'dispatch-observed'
    case 'Cordis.topologyInvalidated': return 'topology-invalidated'
    case 'Profiler.traceUpdated': return 'profiler-trace-updated'
    case 'Profiler.statusChanged': return 'profiler-status-changed'
    case 'Target.targetDestroyed': return 'target-disposed'
    default: return undefined
  }
}

/** Domain owning one protocol event. */
export function protocolDomainForEvent(method: DevtoolsProtocolEventName): DevtoolsProtocolDomainName {
  return method.slice(0, method.indexOf('.')) as DevtoolsProtocolDomainName
}

/** Runtime validation helper shared by protocol adapters. */
export function isProtocolMethod(value: string): value is DevtoolsProtocolMethod {
  return (DEVTOOLS_PROTOCOL_METHODS as readonly string[]).includes(value)
}

/** Runtime validation helper shared by protocol adapters. */
export function isProtocolEvent(value: string): value is DevtoolsProtocolEventName {
  return (DEVTOOLS_PROTOCOL_EVENTS as readonly string[]).includes(value)
}

/** Maps a retained Host observation to its protocol event name and params. */
export function projectDevtoolsProtocolEvent(observation: AgentDebugObservation, sessionId: AgentDebugSessionId): DevtoolsProtocolEvent {
  switch (observation.type) {
    case 'dispatch-observed':
      return {
        method: 'Cordis.dispatchObserved',
        sessionId,
        params: { ...observation },
      }
    case 'topology-invalidated':
      return {
        method: 'Cordis.topologyInvalidated',
        sessionId,
        params: { ...observation },
      }
    case 'profiler-trace-updated':
      return {
        method: 'Profiler.traceUpdated',
        sessionId,
        params: { ...observation },
      }
    case 'profiler-status-changed':
      return {
        method: 'Profiler.statusChanged',
        sessionId,
        params: { ...observation },
      }
    case 'target-disposed':
      return {
        method: 'Target.targetDestroyed',
        sessionId,
        params: { ...observation },
      }
  }
}
