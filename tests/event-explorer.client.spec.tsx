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
  it('keeps Events and Timeline in one DSH-aligned shell with one snapshot poller', async () => {
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

    const eventSearch = container.querySelector<HTMLInputElement>('[data-testid="cordis-devtools-search"]')
    expect(eventSearch).not.toBeNull()
    await setInput(eventSearch, 'beta')
    expect(container.querySelector('[data-event-name="alpha/event"]')).toBeNull()
    expect(container.querySelector('[data-event-name="beta/event"]')).not.toBeNull()
    expect(panel?.textContent).toContain('plugin-beta')

    const timelineButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'Timeline')
    expect(timelineButton).not.toBeUndefined()
    await act(async () => { timelineButton?.click() })

    expect(fetchCalls).toBe(1)
    const rows = [...container.querySelectorAll<HTMLElement>('[data-dispatch-id]')]
    expect(rows.map(row => row.dataset.dispatchId)).toEqual(['3', '2', '1'])
    expect(panel?.textContent).toContain('Recent bounded dispatches')
    expect(panel?.textContent).toContain('waterfall')
    expect(panel?.textContent).toContain('emit')
    expect(panel?.textContent).toContain('serial')
    expect(panel?.textContent).not.toContain('duration')
    expect(panel?.textContent).not.toContain('outcome')

    const row2 = container.querySelector<HTMLElement>('[data-dispatch-id="2"] [data-disclosure-row]')
    await act(async () => { row2?.click() })
    expect(container.querySelector('[data-dispatch-id="2"]')?.textContent).toContain('dispatch id')
    expect(container.querySelector('[data-dispatch-id="2"]')?.textContent).toContain('arguments')
    expect(container.querySelector('[data-dispatch-id="2"]')?.textContent).toContain('plugin-beta')

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

    shouldFail = true
    const refresh = container.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-refresh"]')
    await act(async () => {
      refresh?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="cordis-devtools-error"]')?.textContent)
      .toContain('Stale snapshot · connection lost')
    expect(panel?.textContent).toContain('alpha/event')
  })
})

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
