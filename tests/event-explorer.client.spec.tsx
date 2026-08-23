// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { EventExplorerAction } from '../src/client/EventExplorer.js'
import { EventExplorerStore } from '../src/client/store.js'
import type { DevtoolsSnapshot } from '../src/shared/types.js'

const rootFiber = { uid: 0, name: 'root', state: 'active' }
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
    { uid: 4, name: 'plugin-alpha', state: 'active', parent: rootFiber, inject: ['logger'], effects: [] },
    { uid: 5, name: 'plugin-second', state: 'active', parent: rootFiber, inject: [], effects: [] },
    { uid: 8, name: 'plugin-beta', state: 'active', parent: rootFiber, inject: ['connection'], effects: [] },
    { uid: 9, name: 'plugin-waiting', state: 'pending', parent: rootFiber, inject: ['database'], effects: [] },
  ],
  dispatches: [
    {
      id: 1,
      timestamp: 1_787_496_000_000,
      mode: 'waterfall',
      event: 'alpha/event',
      argCount: 1,
      registeredListeners: 2,
      thisFiber: { uid: 4, name: 'plugin-alpha', state: 'active' },
    },
    {
      id: 2,
      timestamp: 1_787_496_000_250,
      mode: 'emit',
      event: 'beta/event',
      argCount: 2,
      registeredListeners: 1,
      thisFiber: { uid: 8, name: 'plugin-beta', state: 'active' },
    },
    {
      id: 3,
      timestamp: 1_787_496_000_500,
      mode: 'serial',
      event: 'gamma/event',
      argCount: 0,
      registeredListeners: 0,
      thisFiber: null,
    },
    {
      id: 4,
      timestamp: 1_787_496_000_750,
      mode: 'emit',
      event: 'legacy/event',
      argCount: 0,
      registeredListeners: 0,
      thisFiber: { uid: 99, name: 'plugin-gone', state: 'active' },
    },
  ],
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
  it('keeps one snapshot poller while navigating Events, Timeline, and Fibers by live relationships', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let shouldFail = false
    let fetchCalls = 0
    const store = new EventExplorerStore({
      async fetchSnapshot() {
        fetchCalls++
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

    expect(fetchCalls).toBe(1)
    const panel = container.querySelector<HTMLElement>('[data-testid="cordis-devtools-panel"]')
    expect(panel?.textContent).toContain('alpha/event')
    expect(panel?.textContent).toContain('plugin-alpha')
    expect(panel?.textContent).toContain('prepend')
    expect(panel?.textContent).toContain('global')
    expect(panel?.textContent).not.toContain('waterfall')

    const ownerLink = findButton(container, 'plugin-alpha')
    expect(ownerLink).not.toBeUndefined()
    await act(async () => { ownerLink?.click() })
    let fiberDetail = container.querySelector<HTMLElement>('[data-testid="cordis-devtools-fiber-detail"]')
    expect(fiberDetail?.textContent).toContain('plugin-alpha')
    expect(container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')?.getAttribute('aria-label'))
      .toBe('Search live Cordis fibers')

    const ownedAlphaEvent = findButton(fiberDetail ?? container, 'alpha/event')
    expect(ownedAlphaEvent).not.toBeUndefined()
    await act(async () => { ownedAlphaEvent?.click() })
    expect(container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')?.getAttribute('aria-label'))
      .toBe('Search Cordis events')
    expect(container.querySelector('[data-event-name="alpha/event"]')).not.toBeNull()
    expect(fetchCalls).toBe(1)

    const eventSearch = container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')
    expect(eventSearch).not.toBeNull()
    await setInput(eventSearch, 'beta')
    expect(container.querySelector('[data-event-name="alpha/event"]')).toBeNull()
    expect(container.querySelector('[data-event-name="beta/event"]')).not.toBeNull()
    expect(panel?.textContent).toContain('plugin-beta')

    const timelineButton = findButton(container, 'Timeline')
    expect(timelineButton).not.toBeUndefined()
    await act(async () => { timelineButton?.click() })

    expect(fetchCalls).toBe(1)
    const rows = [...container.querySelectorAll<HTMLElement>('[data-dispatch-id]')]
    expect(rows.map(row => row.dataset.dispatchId)).toEqual(['4', '3', '2', '1'])
    expect(panel?.textContent).toContain('Recent bounded dispatches')
    expect(panel?.textContent).toContain('waterfall')
    expect(panel?.textContent).toContain('emit')
    expect(panel?.textContent).toContain('serial')
    expect(panel?.textContent).not.toContain('duration')
    expect(panel?.textContent).not.toContain('outcome')

    const missingRow = container.querySelector<HTMLElement>('[data-dispatch-id="4"]')
    await act(async () => { missingRow?.querySelector<HTMLElement>('[data-disclosure-row]')?.click() })
    expect(missingRow?.textContent).toContain('plugin-gone')
    expect(missingRow?.textContent).toContain('not live')
    expect(findButton(missingRow ?? container, 'plugin-gone')).toBeUndefined()

    const row2 = container.querySelector<HTMLElement>('[data-dispatch-id="2"]')
    await act(async () => { row2?.querySelector<HTMLElement>('[data-disclosure-row]')?.click() })
    expect(row2?.textContent).toContain('dispatch id')
    expect(row2?.textContent).toContain('arguments')
    expect(row2?.textContent).toContain('plugin-beta')

    const dispatchFiberLink = findButton(row2 ?? container, 'plugin-beta')
    expect(dispatchFiberLink).not.toBeUndefined()
    await act(async () => { dispatchFiberLink?.click() })
    fiberDetail = container.querySelector<HTMLElement>('[data-testid="cordis-devtools-fiber-detail"]')
    expect(fiberDetail?.textContent).toContain('plugin-beta')
    expect(fetchCalls).toBe(1)

    await act(async () => { findButton(container, 'Timeline')?.click() })
    const timelineSearch = container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')
    await setInput(timelineSearch, 'plugin-beta')
    expect([...container.querySelectorAll<HTMLElement>('[data-dispatch-id]')].map(row => row.dataset.dispatchId))
      .toEqual(['2'])

    await setInput(timelineSearch, '')
    const waterfallFilter = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="cordis-devtools-mode-filters"] button')]
      .find(button => button.textContent === 'waterfall')
    expect(waterfallFilter).not.toBeUndefined()
    await act(async () => { waterfallFilter?.click() })
    expect([...container.querySelectorAll<HTMLElement>('[data-dispatch-id]')].map(row => row.dataset.dispatchId))
      .toEqual(['1'])

    const fibersButton = findButton(container, 'Fibers')
    expect(fibersButton).not.toBeUndefined()
    await act(async () => { fibersButton?.click() })

    expect(fetchCalls).toBe(1)
    expect([...container.querySelectorAll<HTMLElement>('[data-fiber-uid]')].map(row => row.dataset.fiberUid))
      .toEqual(['4', '5', '8', '9'])
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-fiber-uid="4"]')?.click() })
    fiberDetail = container.querySelector<HTMLElement>('[data-testid="cordis-devtools-fiber-detail"]')
    expect(fiberDetail?.textContent).toContain('plugin-alpha')
    expect(fiberDetail?.textContent).toContain('owned listeners')
    expect(fiberDetail?.textContent).toContain('owned events')
    expect(fiberDetail?.textContent).toContain('recent dispatch-context hits')
    expect(fiberDetail?.textContent).toContain('logger')
    expect(fiberDetail?.textContent).toContain('root')
    expect(fiberDetail?.textContent).not.toContain('Live registry inventory')

    const pendingFilter = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="cordis-devtools-fiber-state-filters"] button')]
      .find(button => button.textContent === 'pending')
    expect(pendingFilter).not.toBeUndefined()
    await act(async () => { pendingFilter?.click() })
    expect([...container.querySelectorAll<HTMLElement>('[data-fiber-uid]')].map(row => row.dataset.fiberUid))
      .toEqual(['9'])
    expect(fiberDetail?.textContent).toContain('plugin-waiting')
    expect(fiberDetail?.textContent).toContain('database')

    const allFiberFilter = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="cordis-devtools-fiber-state-filters"] button')]
      .find(button => button.textContent === 'all')
    await act(async () => { allFiberFilter?.click() })
    const fiberSearch = container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')
    await setInput(fiberSearch, '8')
    expect([...container.querySelectorAll<HTMLElement>('[data-fiber-uid]')].map(row => row.dataset.fiberUid))
      .toEqual(['8'])
    expect(fiberDetail?.textContent).toContain('plugin-beta')

    shouldFail = true
    const refresh = container.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-refresh"]')
    await act(async () => {
      refresh?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="cordis-devtools-error"]')?.textContent)
      .toContain('Stale snapshot · connection lost')
    expect(panel?.textContent).toContain('plugin-beta')
  })
})

function findButton(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === text)
}

async function setInput(input: HTMLInputElement | null, value: string): Promise<void> {
  expect(input).not.toBeNull()
  await act(async () => {
    if (input === null) return
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    expect(valueSetter).toBeTypeOf('function')
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
