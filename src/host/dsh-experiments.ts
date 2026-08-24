import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_WATERFALL_EXPERIMENT_TTL_MS,
  type WaterfallExperimentStartInput,
  type WaterfallExperimentStartResult,
  type WaterfallExperimentStopInput,
  type WaterfallExperimentStopResult,
} from '../shared/experiments.js'

export const DSH_START_WATERFALL_EXPERIMENT_TOOL = 'cordis_start_waterfall_experiment'
export const DSH_STOP_WATERFALL_EXPERIMENT_TOOL = 'cordis_stop_waterfall_experiment'

export interface DshWaterfallExperimentControl {
  startAgent(source: 'dsh', input?: WaterfallExperimentStartInput): WaterfallExperimentStartResult
  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult
}

export type DshExperimentApprovalOutcome =
  | 'rejected'
  | 'cancelled'
  | 'unavailable'
  | 'missing-agent'

export type DshWaterfallExperimentStartToolResult =
  | WaterfallExperimentStartResult
  | {
      outcome: 'approval-denied'
      approval: DshExperimentApprovalOutcome
    }

interface ToolExecutionLike {
  readonly callId?: unknown
  readonly agent?: unknown
  readonly signal: AbortSignal
}

interface ToolDefinitionLike {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: ToolExecutionLike): Promise<unknown>
}

interface ToolRegistryLike {
  register(definition: ToolDefinitionLike): () => void
}

interface ApprovalServiceLike {
  request(request: {
    agent: unknown
    toolName: string
    callId?: unknown
    reason?: string
    signal?: AbortSignal
  }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

const START_PARAMETERS = {
  type: 'object',
  properties: {
    ttlMs: {
      type: 'number',
      description: 'Finite profiling lease duration in milliseconds; omitted uses the runtime default.',
    },
  },
  additionalProperties: false,
} as const

const STOP_PARAMETERS = {
  type: 'object',
  properties: {
    leaseId: {
      type: 'string',
      description: 'Exact lease id returned by cordis_start_waterfall_experiment.',
    },
  },
  required: ['leaseId'],
  additionalProperties: false,
} as const

const JSON_OUTPUT = {
  schema: {},
  render(_args: unknown, value: unknown) {
    return [{ type: 'text' as const, text: JSON.stringify(value) }]
  },
}

export function createDshExperimentToolDefinitions(
  ctx: Context,
  control: DshWaterfallExperimentControl,
): readonly [ToolDefinitionLike, ToolDefinitionLike] {
  const start: ToolDefinitionLike = {
    name: DSH_START_WATERFALL_EXPERIMENT_TOOL,
    description:
      'Request one short, user-approved Cordis waterfall profiling experiment. Returns a finite lease when instrumentation starts.',
    parameters: START_PARAMETERS,
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const ttlMs = readOptionalPositiveFiniteNumber(args, 'ttlMs')
      if (exec.agent === undefined) {
        return approvalDenied('missing-agent')
      }

      const approval = ctx.get('approval') as ApprovalServiceLike | undefined
      if (approval === undefined || typeof approval.request !== 'function') {
        return approvalDenied('unavailable')
      }

      let outcome: Awaited<ReturnType<ApprovalServiceLike['request']>>
      try {
        outcome = await approval.request({
          agent: exec.agent,
          toolName: DSH_START_WATERFALL_EXPERIMENT_TOOL,
          ...(exec.callId === undefined ? {} : { callId: exec.callId }),
          reason: `Enable Cordis waterfall instrumentation for up to ${ttlMs ?? DEFAULT_WATERFALL_EXPERIMENT_TTL_MS} ms.`,
          signal: exec.signal,
        })
      } catch {
        return approvalDenied('unavailable')
      }
      if (outcome !== 'allowed-once') {
        return approvalDenied(outcome)
      }

      return control.startAgent('dsh', ttlMs === undefined ? {} : { ttlMs })
    },
  }

  const stop: ToolDefinitionLike = {
    name: DSH_STOP_WATERFALL_EXPERIMENT_TOOL,
    description: 'Stop only the exact active Cordis waterfall experiment lease returned by this Agent start operation.',
    parameters: STOP_PARAMETERS,
    output: JSON_OUTPUT,
    async execute(args) {
      return control.stopAgent({ leaseId: readRequiredString(args, 'leaseId') })
    },
  }

  return [start, stop]
}

export function installDshExperimentTools(
  ctx: Context,
  control: DshWaterfallExperimentControl,
): void {
  const definitions = createDshExperimentToolDefinitions(ctx, control)

  ctx.inject(['tools'], (toolCtx) => {
    const tools = toolCtx.get('tools') as ToolRegistryLike | undefined
    if (tools === undefined || typeof tools.register !== 'function') {
      throw new Error('dsh-cordis-devtools: tools service does not expose register()')
    }
    toolCtx.effect(() => {
      const disposers = definitions.map(definition => tools.register(definition))
      return () => {
        for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]()
      }
    }, 'dsh-cordis-devtools: controlled waterfall experiment tools')
  })
}

function approvalDenied(approval: DshExperimentApprovalOutcome): DshWaterfallExperimentStartToolResult {
  return { outcome: 'approval-denied', approval }
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('tool arguments must be an object')
  }
  return value as Record<string, unknown>
}

function readOptionalPositiveFiniteNumber(value: unknown, key: string): number | undefined {
  const field = readObject(value)[key]
  if (field === undefined) return undefined
  if (typeof field !== 'number' || !Number.isFinite(field) || field <= 0) {
    throw new RangeError(`${key} must be a positive finite number`)
  }
  return field
}

function readRequiredString(value: unknown, key: string): string {
  const field = readObject(value)[key]
  if (typeof field !== 'string' || field.trim() === '') {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return field
}
