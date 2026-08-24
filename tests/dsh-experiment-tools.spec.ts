import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  createDshExperimentToolDefinitions,
  DSH_START_WATERFALL_EXPERIMENT_TOOL,
  DSH_STOP_WATERFALL_EXPERIMENT_TOOL,
  installDshExperimentTools,
  type DshWaterfallExperimentControl,
} from '../src/host/dsh-experiments.js'

function startResult() {
  return {
    outcome: 'started' as const,
    lease: { leaseId: 'lease-a', source: 'dsh' as const, startedAt: 1, expiresAt: 2 },
    status: {
      generatedAt: 1,
      instrumentation: 'enabled' as const,
      owner: { kind: 'agent' as const, leaseId: 'lease-a', source: 'dsh' as const, startedAt: 1, expiresAt: 2 },
    },
  }
}

function stopResult() {
  return {
    outcome: 'stopped' as const,
    status: { generatedAt: 2, instrumentation: 'disabled' as const, owner: { kind: 'none' as const } },
  }
}

function control(order: string[] = []): DshWaterfallExperimentControl {
  return {
    startAgent: vi.fn((source, input) => {
      order.push(`start:${source}:${input?.ttlMs ?? 'default'}`)
      return startResult()
    }),
    stopAgent: vi.fn((input) => {
      order.push(`stop:${input.leaseId}`)
      return stopResult()
    }),
  }
}

function contextWithApproval(
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | 'throw' | 'missing',
  order: string[] = [],
): Context {
  const approval = outcome === 'missing'
    ? undefined
    : {
        async request(request: { toolName: string; reason?: string }) {
          order.push(`approval:${request.toolName}`)
          if (outcome === 'throw') throw new Error('approval unavailable')
          return outcome
        },
      }
  return {
    get(name: string) {
      return name === 'approval' ? approval : undefined
    },
  } as unknown as Context
}

const exec = {
  callId: 'call-1',
  agent: { id: 'agent' },
  signal: new AbortController().signal,
}

describe('DSH waterfall experiment tools adapter', () => {
  it('exposes a dedicated start/stop pair rather than CordisRuntime mutation', () => {
    const [start, stop] = createDshExperimentToolDefinitions(contextWithApproval('allowed-once'), control())
    expect(start.name).toBe(DSH_START_WATERFALL_EXPERIMENT_TOOL)
    expect(stop.name).toBe(DSH_STOP_WATERFALL_EXPERIMENT_TOOL)
    expect(start.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    expect(stop.parameters).toMatchObject({ required: ['leaseId'] })
  })

  it('requests one-shot approval before the first coordinator mutation', async () => {
    const order: string[] = []
    const experimentControl = control(order)
    const [start] = createDshExperimentToolDefinitions(contextWithApproval('allowed-once', order), experimentControl)

    const result = await start.execute({ ttlMs: 2_500 }, exec)
    expect(order).toEqual([
      `approval:${DSH_START_WATERFALL_EXPERIMENT_TOOL}`,
      'start:dsh:2500',
    ])
    expect(result).toEqual(startResult())
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)(
    'fails closed when approval resolves %s without touching the coordinator',
    async (approvalOutcome) => {
      const experimentControl = control()
      const [start] = createDshExperimentToolDefinitions(contextWithApproval(approvalOutcome), experimentControl)

      await expect(start.execute({}, exec)).resolves.toEqual({
        outcome: 'approval-denied',
        approval: approvalOutcome,
      })
      expect(experimentControl.startAgent).not.toHaveBeenCalled()
    },
  )

  it('fails closed when approval is missing, throws, or Agent identity is absent', async () => {
    const missingControl = control()
    const [missing] = createDshExperimentToolDefinitions(contextWithApproval('missing'), missingControl)
    expect(await missing.execute({}, exec)).toEqual({ outcome: 'approval-denied', approval: 'unavailable' })
    expect(missingControl.startAgent).not.toHaveBeenCalled()

    const throwingControl = control()
    const [throwing] = createDshExperimentToolDefinitions(contextWithApproval('throw'), throwingControl)
    expect(await throwing.execute({}, exec)).toEqual({ outcome: 'approval-denied', approval: 'unavailable' })
    expect(throwingControl.startAgent).not.toHaveBeenCalled()

    const noAgentControl = control()
    const [noAgent] = createDshExperimentToolDefinitions(contextWithApproval('allowed-once'), noAgentControl)
    expect(await noAgent.execute({}, { signal: exec.signal })).toEqual({ outcome: 'approval-denied', approval: 'missing-agent' })
    expect(noAgentControl.startAgent).not.toHaveBeenCalled()
  })

  it('stops only by exact lease id without asking for a second approval', async () => {
    const order: string[] = []
    const experimentControl = control(order)
    const [, stop] = createDshExperimentToolDefinitions(contextWithApproval('allowed-once', order), experimentControl)

    expect(await stop.execute({ leaseId: 'lease-a' }, exec)).toEqual(stopResult())
    expect(order).toEqual(['stop:lease-a'])
  })

  it('rejects malformed local arguments before authority or mutation', async () => {
    const experimentControl = control()
    const [start, stop] = createDshExperimentToolDefinitions(contextWithApproval('allowed-once'), experimentControl)

    await expect(start.execute({ ttlMs: 0 }, exec)).rejects.toThrow('positive finite')
    await expect(stop.execute({ leaseId: '' }, exec)).rejects.toThrow('non-empty')
    expect(experimentControl.startAgent).not.toHaveBeenCalled()
    expect(experimentControl.stopAgent).not.toHaveBeenCalled()
  })

  it('registers both tools only when DSH ToolRuntime exists and disposes them with the injected lifecycle', () => {
    const disposeStart = vi.fn()
    const disposeStop = vi.fn()
    const register = vi.fn((definition: { name: string }) => {
      if (definition.name === DSH_START_WATERFALL_EXPERIMENT_TOOL) return disposeStart
      if (definition.name === DSH_STOP_WATERFALL_EXPERIMENT_TOOL) return disposeStop
      throw new Error('unexpected tool')
    })
    let lifecycleDispose: (() => void) | undefined
    const child = {
      get: vi.fn(() => ({ register })),
      effect: vi.fn((factory: () => () => void) => {
        lifecycleDispose = factory()
        return lifecycleDispose
      }),
    }
    const inject = vi.fn((_services: string[], callback: (ctx: typeof child) => void) => callback(child))
    const ctx = {
      inject,
      get: vi.fn(() => undefined),
    } as unknown as Context

    installDshExperimentTools(ctx, control())

    expect(inject).toHaveBeenCalledWith(['tools'], expect.any(Function))
    expect(register.mock.calls.map(call => call[0].name)).toEqual([
      DSH_START_WATERFALL_EXPERIMENT_TOOL,
      DSH_STOP_WATERFALL_EXPERIMENT_TOOL,
    ])
    lifecycleDispose?.()
    expect(disposeStop).toHaveBeenCalledTimes(1)
    expect(disposeStart).toHaveBeenCalledTimes(1)
  })
})
