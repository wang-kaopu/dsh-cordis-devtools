import type { Context } from '@deepseek-ai/cordis'
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
    limit: { type: 'number', description: 'Maximum returned traces, 1 through 100.' },
  },
  additionalProperties: false,
} as const

export function createCordisRuntimeInspectProvider(
  diagnostics: RuntimeDiagnosticsQuery,
): CordisRuntimeInspectProviderLike {
  return {
    manifest: {
      id: CORDIS_RUNTIME_INSPECT_PROVIDER_ID,
      description:
        'Live Cordis runtime diagnostics: current listener registrations, authoritative Fibers, bounded recent dispatches, and existing waterfall traces.',
      methods: [
        method('runtimeSummary', 'Return compact counts and bounded evidence-window metadata.', EMPTY_INPUT),
        method('inspectEvent', 'Inspect current live listener registrations for one exact event.', EVENT_INPUT),
        method('inspectFiber', 'Inspect one uid or all live Fibers with one exact name.', FIBER_INPUT),
        method('searchDispatches', 'Search the retained bounded observer dispatch window.', DISPATCH_INPUT),
        method('profilerTraces', 'Read existing retained waterfall profiler traces without enabling instrumentation.', PROFILER_INPUT),
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
          const limit = readNumber(row, 'limit')
          return diagnostics.profilerTraces({
            ...(event === undefined ? {} : { event }),
            ...(limit === undefined ? {} : { limit }),
          })
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
