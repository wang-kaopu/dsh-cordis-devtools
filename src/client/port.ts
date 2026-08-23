import type { DevtoolsSnapshot } from '../shared/types.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_SNAPSHOT_ENDPOINT,
} from '../shared/rpc.js'

interface ClientRpcErrorLike {
  code: string
  message: string
}

export interface ClientConnectionLike {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<
      | { ok: true; value: unknown }
      | { ok: false; error: ClientRpcErrorLike }
    >
  }
}

export interface SnapshotPort {
  fetchSnapshot(signal?: AbortSignal): Promise<DevtoolsSnapshot>
}

export function createSnapshotPort(connection: ClientConnectionLike): SnapshotPort {
  return {
    async fetchSnapshot(signal) {
      const result = await connection.rpc.call(
        DEVTOOLS_RPC_CHANNEL,
        DEVTOOLS_RPC_SNAPSHOT_ENDPOINT,
        {},
        signal,
      )
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      if (!isDevtoolsSnapshot(result.value)) {
        throw new Error('Cordis DevTools returned an invalid snapshot')
      }
      return result.value
    },
  }
}

function isDevtoolsSnapshot(value: unknown): value is DevtoolsSnapshot {
  if (!isRecord(value) || typeof value.generatedAt !== 'number') return false
  if (!Array.isArray(value.events) || !Array.isArray(value.listeners)) return false
  if (!Array.isArray(value.fibers) || !Array.isArray(value.dispatches)) return false

  return value.events.every(event =>
    isRecord(event)
    && typeof event.name === 'string'
    && typeof event.listenerCount === 'number'
    && Array.isArray(event.listenerIds)
    && event.listenerIds.every(id => typeof id === 'number'))
    && value.listeners.every(listener =>
      isRecord(listener)
      && typeof listener.id === 'number'
      && typeof listener.event === 'string'
      && typeof listener.order === 'number'
      && typeof listener.prepend === 'boolean'
      && typeof listener.global === 'boolean'
      && (listener.owner === null || isFiber(listener.owner)))
    && value.fibers.every(isFiber)
}

function isFiber(value: unknown): boolean {
  return isRecord(value)
    && (value.uid === null || typeof value.uid === 'number')
    && typeof value.name === 'string'
    && typeof value.state === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
