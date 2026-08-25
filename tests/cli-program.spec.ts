import { describe, expect, it } from 'vitest'
import {
  parseCliArgs,
  runCliProgram,
  type CliFiles,
  type CliIo,
  type ToolClient,
} from '../src/cli/program.js'

function fakeDependencies(
  responses: Record<string, unknown>,
  files: Partial<CliFiles> = {},
) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  const stdout: string[] = []
  const stderr: string[] = []
  const client: ToolClient = {
    async callTool(name, params = {}) {
      calls.push({ name, params })
      const response = responses[name]
      return typeof response === 'function' ? response(params) : response
    },
    async close() { calls.push({ name: 'close', params: {} }) },
  }
  const io: CliIo = {
    writeStdout(text) { stdout.push(text) },
    writeStderr(text) { stderr.push(text) },
  }
  const memoryFiles: CliFiles = {
    readFile: files.readFile ?? (() => '{}'),
    writeFile: files.writeFile ?? (() => {}),
  }
  return { client, io, files: memoryFiles, calls, stdout, stderr }
}

describe('DSH debug CLI program', () => {
  it('parses the supported command grammar and enforces exact fiber selection', () => {
    expect(parseCliArgs(['targets'])).toEqual({ kind: 'targets' })
    expect(parseCliArgs(['fiber', '--uid', '7'])).toEqual({ kind: 'fiber', selector: { uid: 7 } })
    expect(parseCliArgs(['fiber', '--name', 'Plugin'])).toEqual({ kind: 'fiber', selector: { name: 'Plugin' } })
    expect(parseCliArgs(['watch', '--event', 'demo/event', '--timeout', '1000'])).toEqual({ kind: 'watch', event: 'demo/event', timeoutMs: 1000 })
    expect(parseCliArgs(['checkpoint', '--output', 'baseline.json'])).toEqual({ kind: 'checkpoint', output: 'baseline.json' })
    expect(parseCliArgs(['compare', '--baseline', 'baseline.json'])).toEqual({ kind: 'compare', baseline: 'baseline.json' })
    expect(() => parseCliArgs(['fiber', '--uid', '7', '--name', 'Plugin'])).toThrow('exactly one')
    expect(() => parseCliArgs(['profile'])).toThrow('--ttl')
  })

  it('runs snapshot through one transient session and always detaches', async () => {
    const deps = fakeDependencies({
      cordis_list_debug_targets: { targets: [{ targetId: 'target-1', targetEpoch: 3, type: 'cordis-runtime', status: 'active' }] },
      cordis_attach_debug_session: { debugSessionId: 'session-1' },
      cordis_debug_snapshot: { summary: { liveFibers: 1 } },
      cordis_detach_debug_session: { status: 'detached' },
    })
    const result = await runCliProgram(['snapshot'], deps)
    expect(result.exitCode).toBe(0)
    expect(deps.calls.map(call => call.name)).toEqual([
      'cordis_list_debug_targets', 'cordis_attach_debug_session', 'cordis_debug_snapshot', 'cordis_detach_debug_session', 'close',
    ])
    expect(deps.calls[2].params).toMatchObject({ debugSessionId: 'session-1', sections: ['summary', 'events', 'fibers', 'dispatches', 'profiler', 'candidates'] })
  })

  it('watches exactly once with a bounded filter and cleans up', async () => {
    const deps = fakeDependencies({
      cordis_list_debug_targets: { targets: [{ targetId: 'target-1', targetEpoch: 1, type: 'cordis-runtime', status: 'active' }] },
      cordis_attach_debug_session: { session: { debugSessionId: 'session-1' } },
      cordis_wait_for_runtime_change: { outcome: 'timeout' },
      cordis_detach_debug_session: {},
    })
    await runCliProgram(['watch', '--event', 'demo/event', '--timeout', '50'], deps)
    expect(deps.calls.filter(call => call.name === 'cordis_wait_for_runtime_change')).toHaveLength(1)
    expect(deps.calls.find(call => call.name === 'cordis_wait_for_runtime_change')?.params).toEqual({ debugSessionId: 'session-1', event: 'demo/event', timeoutMs: 50 })
  })

  it('uses focused evidence tools and restricts file writes to checkpoint output', async () => {
    const writes: Array<{ path: string; contents: string }> = []
    const deps = fakeDependencies({
      cordis_inspect_event: { found: true },
      cordis_inspect_fiber: { matches: [{ uid: 3 }] },
      cordis_capture_checkpoint: { digest: 'abc', body: { fibers: [] } },
    }, { writeFile(path, contents) { writes.push({ path, contents }) } })
    await runCliProgram(['event', 'demo/event'], deps)
    await runCliProgram(['fiber', '--uid', '3'], deps)
    await runCliProgram(['checkpoint', '--output', 'baseline.json'], deps)
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe('baseline.json')
    expect(JSON.parse(writes[0].contents)).toEqual({ digest: 'abc', body: { fibers: [] } })
    expect(deps.calls.map(call => call.name).filter(name => name === 'cordis_inspect_event')).toHaveLength(1)
  })

  it('reads only compare baselines and emits structured errors without leaking config', async () => {
    const deps = fakeDependencies({ cordis_compare_current: { changed: false } }, { readFile: () => '{"digest":"abc"}' })
    const result = await runCliProgram(['compare', '--baseline', 'baseline.json'], deps)
    expect(result.exitCode).toBe(0)
    expect(deps.calls.find(call => call.name === 'cordis_compare_current')?.params).toEqual({ baseline: { digest: 'abc' } })
    expect(deps.stdout.join('')).not.toContain('token')

    const invalid = fakeDependencies({}, { readFile: () => 'not-json' })
    const invalidResult = await runCliProgram(['compare', '--baseline', 'baseline.json'], invalid)
    expect(invalidResult.exitCode).toBe(1)
    expect(JSON.parse(invalid.stderr[0])).toMatchObject({ error: { code: 'invalid-baseline' } })
  })

  it('stops exactly a started waterfall lease in cleanup', async () => {
    const deps = fakeDependencies({
      cordis_list_debug_targets: { targets: [{ targetId: 'target-1', targetEpoch: 1, type: 'cordis-runtime', status: 'active' }] },
      cordis_attach_debug_session: { debugSessionId: 'session-1' },
      cordis_start_waterfall_experiment: { outcome: 'started', lease: { leaseId: 'lease-1' } },
      cordis_stop_waterfall_experiment: { outcome: 'stopped' },
      cordis_detach_debug_session: {},
    })
    const result = await runCliProgram(['profile', '--ttl', '100'], deps)
    expect(result.exitCode).toBe(0)
    expect(deps.calls.map(call => call.name)).toEqual([
      'cordis_list_debug_targets', 'cordis_attach_debug_session', 'cordis_start_waterfall_experiment',
      'cordis_stop_waterfall_experiment', 'cordis_detach_debug_session', 'close',
    ])
    expect(deps.calls[2].params).toEqual({ debugSessionId: 'session-1', ttlMs: 100 })
    expect(deps.calls[3].params).toEqual({ debugSessionId: 'session-1', leaseId: 'lease-1' })

    const notStarted = fakeDependencies({
      cordis_list_debug_targets: { targets: [{ targetId: 'target-1', targetEpoch: 1, type: 'cordis-runtime', status: 'active' }] },
      cordis_attach_debug_session: { debugSessionId: 'session-1' },
      cordis_start_waterfall_experiment: { outcome: 'busy' },
      cordis_detach_debug_session: {},
    })
    await runCliProgram(['profile', '--ttl', '100'], notStarted)
    expect(notStarted.calls.map(call => call.name)).toEqual([
      'cordis_list_debug_targets', 'cordis_attach_debug_session', 'cordis_start_waterfall_experiment',
      'cordis_detach_debug_session', 'close',
    ])
  })
})
