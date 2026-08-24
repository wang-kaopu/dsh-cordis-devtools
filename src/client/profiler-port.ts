import type { WaterfallDispatchTrace, WaterfallProfilerSnapshot } from '../shared/trace.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
  DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT,
  DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT,
} from '../shared/rpc.js'
import type { ClientConnectionLike } from './port.js'

export interface ProfilerPort {
  fetchSnapshot(signal?: AbortSignal): Promise<WaterfallProfilerSnapshot>
  setEnabled(enabled: boolean, signal?: AbortSignal): Promise<WaterfallProfilerSnapshot>
}

const instrumentationStates = new Set(['disabled', 'enabled', 'conflict', 'unsupported'])
const outcomes = new Set(['running', 'returned', 'threw', 'pending', 'fulfilled', 'rejected'])

export function createProfilerPort(connection: ClientConnectionLike): ProfilerPort {
  const call = async (endpoint: string, signal?: AbortSignal): Promise<WaterfallProfilerSnapshot> => {
    const result = await connection.rpc.call(
      DEVTOOLS_RPC_CHANNEL,
      endpoint,
      {},
      signal,
    )
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    if (!isProfilerSnapshot(result.value)) {
      throw new Error('Cordis DevTools returned an invalid profiler snapshot')
    }
    return result.value
  }

  return {
    fetchSnapshot: signal => call(DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT, signal),
    setEnabled: (enabled, signal) => call(
      enabled
        ? DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT
        : DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
      signal,
    ),
  }
}

function isProfilerSnapshot(value: unknown): value is WaterfallProfilerSnapshot {
  return isRecord(value)
    && typeof value.generatedAt === 'number'
    && typeof value.instrumentation === 'string'
    && instrumentationStates.has(value.instrumentation)
    && Array.isArray(value.traces)
    && value.traces.every(isTrace)
}

function isTrace(value: unknown): value is WaterfallDispatchTrace {
  return isRecord(value)
    && value.version === 1
    && typeof value.id === 'string'
    && value.mode === 'waterfall'
    && typeof value.event === 'string'
    && typeof value.startedAt === 'number'
    && nullableNumber(value.returnedAt)
    && nullableNumber(value.settledAt)
    && isOutcome(value.outcome)
    && Array.isArray(value.listeners)
    && value.listeners.every(listener =>
      isRecord(listener)
      && typeof listener.id === 'string'
      && typeof listener.listenerId === 'string'
      && (listener.owner === null || isFiber(listener.owner))
      && typeof listener.order === 'number'
      && typeof listener.enteredAt === 'number'
      && nullableNumber(listener.returnedAt)
      && nullableNumber(listener.settledAt)
      && isOutcome(listener.outcome)
      && Array.isArray(listener.nextCalls)
      && listener.nextCalls.every(call =>
        isRecord(call)
        && typeof call.id === 'number'
        && typeof call.calledAt === 'number'
        && nullableNumber(call.returnedAt)
        && nullableNumber(call.settledAt)
        && isOutcome(call.outcome)))
}

function isFiber(value: unknown): boolean {
  return isRecord(value)
    && (value.uid === null || typeof value.uid === 'number')
    && typeof value.name === 'string'
    && typeof value.state === 'string'
}

function isOutcome(value: unknown): boolean {
  return typeof value === 'string' && outcomes.has(value)
}

function nullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
