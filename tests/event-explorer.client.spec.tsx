// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { EventExplorerAction } from '../src/client/EventExplorer.js'
import { EventExplorerStore } from '../src/client/store.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

const snapshot: DevtoolsSnapshot = {
  generatedAt: 1_787_496_000_000,
  events: [
    { name: 'alpha/event', listenerCount: 2, listenerIds: [11, 12] },
    { name: 'beta/event', listenerCount: 1, listenerIds: [21] },
  ],
  listeners: [
    {
      id: 11,
      event: 'alpha/event',
      order: 0,
      prepend: true,
      global: true,
      owner: { uid: 4, name: 'plugin-alpha', state: 'active' },
    },
    {
      id: 12,
      event: 'alpha/event',
      order: 1,
      prepend: false,
      global: false,
      owner: { uid: 5, name: 'plugin-second', state: 'active' },
    },
    {
      id: 21,
      event: 'beta/event',
      order: 0,
      prepend: false,
      global: false,
      owner: { uid: 8, name: 'plugin-beta', state: 'active' },
    },
  ],
  fibers: [
    { uid: 4, name: 'plugin-alpha', state: 'active' },
    { uid: 5, name: 'plugin-second', state: 'active' },
    { uid: 8, name: 'plugin-beta', state: 'active' },
  ],
  dispatches: [{
    id: 1,
    timestamp: 1_787_496_000_000,
    mode: 'waterfall',
    event: 'alpha/event',
    argCount: 1,
    registeredListeners: 2,
    thisFiber: null,
  }],
}

const mounted: Array<() => void> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const cleanup = mounted.pop()
    if (cleanup !== undefined) await act(async () => { cleanup() })
  }
  document.body.innerHTML = ''
})

describe('EventExplorerAction', () => {
  it('renders searchable event/listener facts without inventing dispatch mode', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let shouldFail = false
    const store = new EventExplorerStore({
      async fetchSnapshot() {
        if (shouldFail) throw new Error('connection lost')
        return snapshot
      },
    }, 60_000)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push(() => {
      root.unmount()
      store.dispose()
    })

    await act(async () => {
      root.render(<EventExplorerAction wide store={store} />)
    })

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const panel = container.querySelector<HTMLElement>('[data-testid="cordis-devtools-panel"]')
    expect(panel?.textContent).toContain('alpha/event')
    expect(panel?.textContent).toContain('plugin-alpha')
    expect(panel?.textContent).toContain('prepend')
    expect(panel?.textContent).toContain('global')
    expect(panel?.textContent).not.toContain('waterfall')

    const search = container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')
    expect(search).not.toBeNull()
    await act(async () => {
      if (search !== null) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        expect(valueSetter).toBeTypeOf('function')
        valueSetter?.call(search, 'beta')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    expect(container.querySelector('[data-event-name="alpha/event"]')).toBeNull()
    expect(container.querySelector('[data-event-name="beta/event"]')).not.toBeNull()
    expect(panel?.textContent).toContain('plugin-beta')

    shouldFail = true
    const refresh = container.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-refresh"]')
    await act(async () => {
      refresh?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="cordis-devtools-error"]')?.textContent)
      .toContain('Stale snapshot · connection lost')
    expect(panel?.textContent).toContain('beta/event')
  })
})
