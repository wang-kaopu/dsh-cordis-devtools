import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventExplorerStore } from '../src/client/store.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

const snapshot: DevtoolsSnapshot = {
  generatedAt: 10,
  events: [],
  listeners: [],
  fibers: [],
  dispatches: [],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EventExplorerStore', () => {
  it('polls only while open and never overlaps refresh loops', async () => {
    vi.useFakeTimers()
    const fetchSnapshot = vi.fn(async () => snapshot)
    const store = new EventExplorerStore({ fetchSnapshot }, 1000)

    expect(fetchSnapshot).not.toHaveBeenCalled()

    store.setOpen(true)
    await Promise.resolve()
    expect(fetchSnapshot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)

    store.setOpen(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)

    store.dispose()
  })

  it('marks the retained snapshot stale after a failed refresh', async () => {
    let shouldFail = false
    const store = new EventExplorerStore({
      async fetchSnapshot() {
        if (shouldFail) throw new Error('connection lost')
        return snapshot
      },
    })

    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      snapshot,
      loading: false,
      stale: false,
    })

    shouldFail = true
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      snapshot,
      loading: false,
      stale: true,
      error: 'connection lost',
    })

    store.dispose()
  })
})
