import { describe, expect, it } from 'vitest'
import {
  AGENT_DEBUG_CAPABILITIES,
  AGENT_DEBUG_SESSION_STATUSES,
  AGENT_DEBUG_MECHANICAL_CANDIDATE_KINDS,
  AGENT_DEBUG_OBSERVATION_TYPES,
  AGENT_DEBUG_PROTOCOL_NAME,
  AGENT_DEBUG_PROTOCOL_VERSION,
  AGENT_DEBUG_SNAPSHOT_SECTIONS,
  AGENT_DEBUG_TARGET_STATUSES,
  AGENT_DEBUG_TARGET_TYPE,
  AGENT_DEBUG_WAIT_OUTCOMES,
  DEFAULT_AGENT_DEBUG_CATALOG_LIMIT,
  DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS,
  MAX_AGENT_DEBUG_CATALOG_LIMIT,
  MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS,
} from '../src/shared/agent-debug.js'
import type {
  AgentDebugDispatchObserved,
  AgentDebugExplorationSnapshot,
  AgentDebugWaitForRuntimeChangeInput,
  AgentDebugWaitForRuntimeChangeResult,
} from '../src/shared/agent-debug.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { RuntimeDiagnosticsSummary } from '../src/shared/diagnostics.js'
import type { WaterfallExperimentStatus } from '../src/shared/experiments.js'

describe('Agent Debug shared contract', () => {
  it('freezes the v1 protocol vocabulary and defaults', () => {
    expect(AGENT_DEBUG_PROTOCOL_NAME).toBe('dsh-devtools-for-agents')
    expect(AGENT_DEBUG_PROTOCOL_VERSION).toBe(1)
    expect(DEFAULT_AGENT_DEBUG_CATALOG_LIMIT).toBe(100)
    expect(MAX_AGENT_DEBUG_CATALOG_LIMIT).toBe(100)
    expect(DEFAULT_AGENT_DEBUG_WAIT_TIMEOUT_MS).toBe(15_000)
    expect(MAX_AGENT_DEBUG_WAIT_TIMEOUT_MS).toBe(60_000)
    expect(AGENT_DEBUG_TARGET_TYPE).toBe('cordis-runtime')
    expect(AGENT_DEBUG_TARGET_STATUSES).toEqual(['active', 'disposed'])
    expect(AGENT_DEBUG_SESSION_STATUSES).toEqual(['active', 'stale', 'detached', 'expired'])
    expect(AGENT_DEBUG_CAPABILITIES).toEqual([
      'target-discovery',
      'debug-session',
      'runtime-snapshot',
      'runtime-wait',
      'checkpoint-compare',
      'waterfall-profiler',
    ])
    expect(AGENT_DEBUG_OBSERVATION_TYPES).toEqual([
      'dispatch-observed',
      'topology-invalidated',
      'profiler-trace-updated',
      'profiler-status-changed',
      'target-disposed',
    ])
    expect(AGENT_DEBUG_SNAPSHOT_SECTIONS).toEqual([
      'summary',
      'events',
      'fibers',
      'dispatches',
      'profiler',
      'candidates',
    ])
    expect(AGENT_DEBUG_MECHANICAL_CANDIDATE_KINDS).toEqual([
      'duplicate-live-fibers',
      'equivalent-listener-registrations',
      'orphaned-listener-owner',
      'trace-next-anomaly',
      'instrumentation-conflict',
    ])
    expect(AGENT_DEBUG_WAIT_OUTCOMES).toEqual(['found', 'timeout', 'gap'])
  })

  it('keeps observations metadata-only and disallows diagnosis fields', () => {
    const dispatch: AgentDebugDispatchObserved = {
      type: 'dispatch-observed',
      sequence: 3,
      observedAt: 100,
      dispatchId: 8,
      event: 'internal/dispatch',
      mode: 'emit',
      argCount: 1,
      registeredListeners: 2,
    }

    expect(dispatch).not.toHaveProperty('args')
    expect(dispatch).not.toHaveProperty('returns')
    expect(dispatch).not.toHaveProperty('error')
    expect(dispatch).not.toHaveProperty('rootCause')
    expect(dispatch).not.toHaveProperty('confidence')
    expect(dispatch).not.toHaveProperty('remediation')
  })

  it('expresses exact wait filters and explicit found/timeout/gap outcomes', () => {
    const input: AgentDebugWaitForRuntimeChangeInput = {
      debugSessionId: 'opaque-session',
      afterSequence: 12,
      type: 'dispatch-observed',
      event: 'internal/dispatch',
      timeoutMs: 1_000,
    }
    const result: AgentDebugWaitForRuntimeChangeResult = {
      outcome: 'timeout',
      observation: null,
      window: {
        bounded: true,
        oldestSequence: 10,
        newestSequence: 12,
        retained: 3,
        truncated: false,
        gap: false,
      },
      session: {
        debugSessionId: input.debugSessionId,
        targetId: 'opaque-target',
        targetEpoch: 1,
        status: 'active',
        stale: false,
        staleReason: null,
        createdAt: 1,
        lastAccessedAt: 2,
        observationSequence: 12,
      },
    }

    expect(result.outcome).toBe('timeout')
    expect(input.type).toBe('dispatch-observed')
    expect(input.event).toBe('internal/dispatch')
  })

  it('is transport-neutral and can compose existing shared facts by type only', () => {
    const snapshot: DevtoolsSnapshot | null = null
    const summary: RuntimeDiagnosticsSummary | null = null
    const experiment: WaterfallExperimentStatus | null = null
    const exploration: AgentDebugExplorationSnapshot | null = null

    expect(snapshot).toBeNull()
    expect(summary).toBeNull()
    expect(experiment).toBeNull()
    expect(exploration).toBeNull()
  })
})
