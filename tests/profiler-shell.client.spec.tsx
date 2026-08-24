// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventExplorerAction } from '../src/client/EventExplorer.js'
import { ProfilerStore } from '../src/client/profiler-store.js'
import { EventExplorerStore } from '../src/client/store.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'
import type { WaterfallProfilerSnapshot } from '../src/shared/trace.js'

const observerSnapshot: DevtoolsSnapshot = {
  generatedAt: 1,
  events: [],
  listeners: [],
  fibers: [{
    uid: 7,
    name: 'loader-plugin',
    state: 'active',
    parent: { uid: 0, name: 'root', state: 'active' },
    inject: [],
    effects: [],
  }],
  dispatches: [],
}

const trace = {
  version: 1 as const,
  id: 'trace-1',
  mode: 'waterfall' as const,
  event: 'loader/entry-init',
  startedAt: 10,
  returnedAt: 18,
  settledAt: 20,
  outcome: 'fulfilled' as const,
  listeners: [{
    id: 'span-1',
    listenerId: 'listener-1',
    owner: { uid: 7, name: 'loader-plugin', state: 'active' },
    order: 0,
    enteredAt: 11,
    returnedAt: 18,
    settledAt: 20,
    outcome: 'fulfilled' as const,
    nextCalls: [],
  }],
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let observerStore: EventExplorerStore | undefined
let profilerStore: ProfilerStore | undefined

afterEach(async () => {
  if (root !== undefined) await act(async () => { root?.unmount() })
  profilerStore?.dispose()
  observerStore?.dispose()
  host?.remove()
  root = undefined
  host = undefined
  observerStore = undefined
  profilerStore = undefined
})

describe('Profiler shell integration', () => {
  it('opens read-only, toggles explicitly, and navigates trace owners back to Fibers', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let observerFetches = 0
    let profilerFetches = 0
    let serverSnapshot: WaterfallProfilerSnapshot = {
      generatedAt: 2,
      instrumentation: 'disabled',
      traces: [],
    }
    const toggles: boolean[] = []

    observerStore = new EventExplorerStore({
      async fetchSnapshot() {
        observerFetches++
        return observerSnapshot
      },
    }, 60_000)
    profilerStore = new ProfilerStore({
      async fetchSnapshot() {
        profilerFetches++
        return serverSnapshot
      },
      async setEnabled(enabled) {
        toggles.push(enabled)
        serverSnapshot = {
          generatedAt: serverSnapshot.generatedAt + 1,
          instrumentation: enabled ? 'enabled' : 'disabled',
          traces: enabled ? [trace] : serverSnapshot.traces,
        }
        return serverSnapshot
      },
    }, 60_000)
    const activeSpy = vi.spyOn(profilerStore, 'setActive')

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<EventExplorerAction wide store={observerStore!} profilerStore={profilerStore!} />)
    })

    await act(async () => {
      host!.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-trigger"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observerFetches).toBe(1)
    expect(profilerFetches).toBe(0)
    expect(toggles).toEqual([])

    await act(async () => {
      findButton(host!, 'Profiler')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observerFetches).toBe(1)
    expect(profilerFetches).toBe(1)
    expect(toggles).toEqual([])
    expect(host.textContent).toContain('Waterfall Profiler')
    expect(host.textContent).toContain('disabled')
    expect(host.querySelector('[data-testid="cordis-devtools-search"]')).toBeNull()
    expect(host.querySelector('[data-testid="cordis-devtools-refresh"]')?.getAttribute('aria-label'))
      .toBe('Refresh profiler snapshot')

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-profiler-toggle"]')
    expect(toggle?.textContent).toBe('Enable profiling')
    await act(async () => {
      toggle?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(toggles).toEqual([true])
    expect(host.textContent).toContain('enabled')
    expect(host.textContent).toContain('loader/entry-init')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent)
      .toBe('Disable profiling')

    const traceDisclosure = host.querySelector<HTMLElement>('[data-trace-id="trace-1"] [data-disclosure-row]')
    await act(async () => { traceDisclosure?.click() })
    const owner = findButton(host, 'loader-plugin')
    expect(owner).not.toBeUndefined()
    await act(async () => { owner?.click() })

    expect(activeSpy).toHaveBeenLastCalledWith(false)
    expect(host.querySelector('[data-testid="cordis-devtools-fiber-detail"]')?.textContent)
      .toContain('loader-plugin')
    expect(host.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')?.getAttribute('aria-label'))
      .toBe('Search live Cordis fibers')
    expect(observerFetches).toBe(1)

    await act(async () => {
      findButton(host!, 'Profiler')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(profilerFetches).toBe(2)
    const disable = host.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-profiler-toggle"]')
    expect(disable?.textContent).toBe('Disable profiling')
    await act(async () => {
      disable?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(toggles).toEqual([true, false])
    expect(host.textContent).toContain('disabled')
  })
})

function findButton(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === text)
}
