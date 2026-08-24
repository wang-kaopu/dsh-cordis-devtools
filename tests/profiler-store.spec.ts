import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilerStore } from '../src/client/profiler-store.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const disabled: WaterfallProfilerSnapshot = {
  generatedAt: 1,
  instrumentation: 'disabled',
  traces: [],
}
const enabled: WaterfallProfilerSnapshot = {
  generatedAt: 2,
  instrumentation: 'enabled',
  traces: [],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ProfilerStore', () => {
  it('polls only while active and opening never enables instrumentation', async () => {
    vi.useFakeTimers()
    const fetchSnapshot = vi.fn(async () => disabled)
    const setEnabled = vi.fn(async () => enabled)
    const store = new ProfilerStore({ fetchSnapshot, setEnabled }, 1000)

    expect(fetchSnapshot).not.toHaveBeenCalled()
    expect(setEnabled).not.toHaveBeenCalled()

    store.setActive(true)
    await Promise.resolve()
    expect(fetchSnapshot).toHaveBeenCalledTimes(1)
    expect(setEnabled).not.toHaveBeenCalled()
    expect(store.getSnapshot().snapshot?.instrumentation).toBe('disabled')

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)
    expect(setEnabled).not.toHaveBeenCalled()

    store.setActive(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)
    store.dispose()
  })

  it('aborts an in-flight read so an explicit toggle is not lost', async () => {
    let readSignal: AbortSignal | undefined
    const fetchSnapshot = vi.fn((_signal?: AbortSignal) => {
      readSignal = _signal
      return new Promise<WaterfallProfilerSnapshot>(() => {})
    })
    const setEnabled = vi.fn(async (value: boolean) => value ? enabled : disabled)
    const store = new ProfilerStore({ fetchSnapshot, setEnabled })

    store.setActive(true)
    await Promise.resolve()
    expect(fetchSnapshot).toHaveBeenCalledTimes(1)
    expect(readSignal?.aborted).toBe(false)

    await store.setEnabled(true)
    expect(readSignal?.aborted).toBe(true)
    expect(setEnabled).toHaveBeenCalledTimes(1)
    expect(setEnabled).toHaveBeenCalledWith(true, expect.any(AbortSignal))
    expect(store.getSnapshot()).toMatchObject({
      snapshot: enabled,
      mutating: false,
      stale: false,
    })

    store.dispose()
  })

  it('keeps the prior profiler snapshot stale after a failed refresh', async () => {
    let fail = false
    const store = new ProfilerStore({
      async fetchSnapshot() {
        if (fail) throw new Error('profiler connection lost')
        return enabled
      },
      async setEnabled(value) {
        return value ? enabled : disabled
      },
    })

    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({ snapshot: enabled, stale: false })

    fail = true
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      snapshot: enabled,
      stale: true,
      error: 'profiler connection lost',
    })
    store.dispose()
  })

  it('retains the previous state when a mutation fails', async () => {
    const store = new ProfilerStore({
      async fetchSnapshot() { return disabled },
      async setEnabled() { throw new Error('enable rejected') },
    })
    await store.refresh()
    await store.setEnabled(true)

    expect(store.getSnapshot()).toMatchObject({
      snapshot: disabled,
      stale: true,
      mutating: false,
      error: 'enable rejected',
    })
    store.dispose()
  })
})
