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
  if (!isRecord(value) || typeof value.generatedAt !== 'number') return false
  if (!['disabled', 'enabled', 'conflict', 'unsupported'].includes(String(value.instrumentation))) return false
  return Array.isArray(value.traces) && value.traces.every(isTrace)
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
    && typeof value.outcome === 'string'
    && Array.isArray(value.listeners)
}

function nullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
