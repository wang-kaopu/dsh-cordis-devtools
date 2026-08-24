import type { Context } from '@deepseek-ai/cordis'
import type { RuntimeCheckpoint, RuntimeCheckpointScope } from '../shared/verification.js'
import type { RuntimeDiagnosticsQuery } from './diagnostics.js'

export const CORDIS_RUNTIME_INSPECT_PROVIDER_ID = 'CordisRuntime'

interface InspectMethodManifestLike {
  name: string
  description: string
  inputSchema: unknown
  outputSchema: unknown
}

interface InspectProviderManifestLike {
  id: string
  description: string
  methods: InspectMethodManifestLike[]
}

export interface CordisRuntimeInspectProviderLike {
  manifest: InspectProviderManifestLike
  query(method: string, input: unknown): Promise<unknown>
}

interface CordisInspectRegistryLike {
  register(provider: CordisRuntimeInspectProviderLike): () => void
}

const EMPTY_INPUT = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

const GENERIC_OUTPUT = {
  description: 'Read-only Cordis runtime diagnostics JSON owned by dsh-cordis-devtools.',
} as const

const EVENT_INPUT = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Exact live Cordis event name.' },
  },
  required: ['name'],
  additionalProperties: false,
} as const

const FIBER_INPUT = {
  type: 'object',
  properties: {
    uid: { type: 'number', description: 'Exact authoritative live Fiber uid.' },
    name: { type: 'string', description: 'Exact live Fiber name; may match multiple Fibers.' },
  },
  additionalProperties: false,
} as const

const DISPATCH_INPUT = {
  type: 'object',
  properties: {
    event: { type: 'string', description: 'Exact event name filter.' },
    fiberUid: { type: 'number', description: 'Exact dispatch-context Fiber uid filter.' },
    mode: { type: 'string', description: 'Exact dispatch mode filter.' },
    limit: { type: 'number', description: 'Maximum returned records, 1 through 100.' },
  },
  additionalProperties: false,
} as const

const PROFILER_INPUT = {
  type: 'object',
  properties: {
    event: { type: 'string', description: 'Exact waterfall event name filter.' },
    experimentId: { type: 'string', description: 'Exact Agent experiment lease id filter.' },
    limit: { type: 'number', description: 'Maximum returned traces, 1 through 100.' },
  },
  additionalProperties: false,
} as const

const CHECKPOINT_SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    eventNames: { type: 'array', items: { type: 'string' }, description: 'Exact event names to include.' },
    fiberNames: { type: 'array', items: { type: 'string' }, description: 'Exact live Fiber names to include.' },
  },
  additionalProperties: false,
} as const

const CHECKPOINT_INPUT = {
  type: 'object',
  properties: {
    scope: CHECKPOINT_SCOPE_SCHEMA,
  },
  additionalProperties: false,
} as const

const COMPARE_INPUT = {
  type: 'object',
  properties: {
    baseline: { type: 'object', description: 'Self-contained RuntimeCheckpoint returned by captureCheckpoint.' },
  },
  required: ['baseline'],
  additionalProperties: false,
} as const

export function createCordisRuntimeInspectProvider(
  diagnostics: RuntimeDiagnosticsQuery,
): CordisRuntimeInspectProviderLike {
  return {
    manifest: {
      id: CORDIS_RUNTIME_INSPECT_PROVIDER_ID,
      description:
        'Live Cordis runtime diagnostics and read-only before/after verification: listeners, authoritative Fibers, bounded recent dispatches, existing waterfall traces, controlled experiment ownership, and semantic checkpoints.',
      methods: [
        method('runtimeSummary', 'Return compact counts and bounded evidence-window metadata.', EMPTY_INPUT),
        method('inspectEvent', 'Inspect current live listener registrations for one exact event.', EVENT_INPUT),
        method('inspectFiber', 'Inspect one uid or all live Fibers with one exact name.', FIBER_INPUT),
        method('searchDispatches', 'Search the retained bounded observer dispatch window.', DISPATCH_INPUT),
        method('profilerTraces', 'Read existing retained waterfall profiler traces without enabling instrumentation.', PROFILER_INPUT),
        method('waterfallExperimentStatus', 'Read current waterfall instrumentation ownership and finite Agent lease facts.', EMPTY_INPUT),
        method('captureCheckpoint', 'Capture a self-contained authoritative runtime topology checkpoint.', CHECKPOINT_INPUT),
        method('compareCurrent', 'Compare a caller-owned baseline checkpoint with fresh current runtime topology.', COMPARE_INPUT),
      ],
    },
    async query(requested, input) {
      switch (requested) {
        case 'runtimeSummary':
          readObject(input)
          return diagnostics.runtimeSummary()
        case 'inspectEvent': {
          const row = readObject(input)
          return diagnostics.inspectEvent(readString(row, 'name', true)!)
        }
        case 'inspectFiber': {
          const row = readObject(input)
          const uid = readNumber(row, 'uid')
          const name = readString(row, 'name')
          if ((uid === undefined) === (name === undefined)) {
            throw new TypeError('inspectFiber requires exactly one of uid or name')
          }
          return diagnostics.inspectFiber(uid === undefined ? { name: name! } : { uid })
        }
        case 'searchDispatches': {
          const row = readObject(input)
          const event = readString(row, 'event')
          const fiberUid = readNumber(row, 'fiberUid')
          const mode = readString(row, 'mode')
          const limit = readNumber(row, 'limit')
          return diagnostics.searchDispatches({
            ...(event === undefined ? {} : { event }),
            ...(fiberUid === undefined ? {} : { fiberUid }),
            ...(mode === undefined ? {} : { mode }),
            ...(limit === undefined ? {} : { limit }),
          })
        }
        case 'profilerTraces': {
          const row = readObject(input)
          const event = readString(row, 'event')
          const experimentId = readString(row, 'experimentId')
          const limit = readNumber(row, 'limit')
          return diagnostics.profilerTraces({
            ...(event === undefined ? {} : { event }),
            ...(experimentId === undefined ? {} : { experimentId }),
            ...(limit === undefined ? {} : { limit }),
          })
        }
        case 'waterfallExperimentStatus':
          readObject(input)
          return diagnostics.waterfallExperimentStatus()
        case 'captureCheckpoint': {
          const row = readObject(input)
          const scope = row.scope === undefined ? undefined : readCheckpointScope(row.scope)
          return diagnostics.captureCheckpoint(scope === undefined ? {} : { scope })
        }
        case 'compareCurrent': {
          const row = readObject(input)
          return diagnostics.compareCurrent({ baseline: readCheckpoint(row, 'baseline') })
        }
        default:
          throw new Error(`unknown CordisRuntime inspect method "${requested}"`)
      }
    },
  }
}

export function installCordisRuntimeInspect(
  ctx: Context,
  diagnostics: RuntimeDiagnosticsQuery,
): void {
  const provider = createCordisRuntimeInspectProvider(diagnostics)

  ctx.inject(['cordisInspect'], (inspectCtx) => {
    const registry = inspectCtx.get('cordisInspect') as CordisInspectRegistryLike | undefined
    if (registry === undefined || typeof registry.register !== 'function') {
      throw new Error('dsh-cordis-devtools: cordisInspect service does not expose register()')
    }
    inspectCtx.effect(
      () => registry.register(provider),
      'dsh-cordis-devtools: CordisRuntime inspect provider',
    )
  })
}

function method(name: string, description: string, inputSchema: unknown): InspectMethodManifestLike {
  return { name, description, inputSchema, outputSchema: GENERIC_OUTPUT }
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('CordisRuntime inspect input must be an object')
  }
  return value as Record<string, unknown>
}

function readString(row: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = row[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    throw new TypeError(`${key} must be ${required ? 'a non-empty ' : ''}string`)
  }
  return value
}

function readNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`)
  return value
}

function readStringArray(row: Record<string, unknown>, key: string): string[] | undefined {
  const value = row[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${key} must be an array of strings`)
  }
  return [...value]
}

function readCheckpointScope(value: unknown): RuntimeCheckpointScope {
  const row = readObject(value)
  const eventNames = readStringArray(row, 'eventNames')
  const fiberNames = readStringArray(row, 'fiberNames')
  return {
    ...('eventNames' in row ? { eventNames: eventNames! } : {}),
    ...('fiberNames' in row ? { fiberNames: fiberNames! } : {}),
  }
}

function readCheckpoint(row: Record<string, unknown>, key: string): RuntimeCheckpoint {
  const value = row[key]
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${key} must be a RuntimeCheckpoint object`)
  }
  return value as RuntimeCheckpoint
}
