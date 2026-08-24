import { describe, expect, it, vi } from 'vitest'
import { createProfilerPort, type ProfilerPort } from '../src/client/profiler-port.js'
import {
  DEVTOOLS_RPC_CHANNEL,
  DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
  DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT,
  DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT,
} from '../src/shared/rpc.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const snapshot: WaterfallProfilerSnapshot = {
  generatedAt: 1,
  instrumentation: 'disabled',
  traces: [],
}

function createPort(): { port: ProfilerPort; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn(async () => ({ ok: true as const, value: snapshot }))
  const port = createProfilerPort({ rpc: { call } })
  return { port, call }
}

describe('profiler port', () => {
  it('uses separate snapshot and explicit instrumentation endpoints', async () => {
    const { port, call } = createPort()
    const signal = new AbortController().signal

    await expect(port.fetchSnapshot(signal)).resolves.toBe(snapshot)
    await expect(port.setEnabled(true, signal)).resolves.toBe(snapshot)
    await expect(port.setEnabled(false, signal)).resolves.toBe(snapshot)

    expect(call.mock.calls.map(([, endpoint]) => endpoint)).toEqual([
      DEVTOOLS_RPC_PROFILER_SNAPSHOT_ENDPOINT,
      DEVTOOLS_RPC_INSTRUMENTATION_ENABLE_ENDPOINT,
      DEVTOOLS_RPC_INSTRUMENTATION_DISABLE_ENDPOINT,
    ])
    expect(call.mock.calls.every(([channel]) => channel === DEVTOOLS_RPC_CHANNEL)).toBe(true)
  })

  it('rejects invalid profiler snapshots instead of accepting arbitrary RPC data', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { instrumentation: 'enabled' } }))
    const port = createProfilerPort({ rpc: { call } })
    await expect(port.fetchSnapshot()).rejects.toThrow('invalid profiler snapshot')
  })
})
