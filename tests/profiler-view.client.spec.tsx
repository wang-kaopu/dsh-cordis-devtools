// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilerView } from '../src/client/views/ProfilerView.js'
import type { WaterfallDispatchTrace } from '../src/shared/trace.js'

const trace: WaterfallDispatchTrace = {
  version: 1,
  id: 'trace-1',
  mode: 'waterfall',
  event: 'loader/entry-init',
  startedAt: 10,
  returnedAt: 18,
  settledAt: 24,
  outcome: 'fulfilled',
  listeners: [{
    id: 'span-1',
    listenerId: 'listener-1',
    owner: { uid: 7, name: 'loader-plugin', state: 'active' },
    order: 0,
    enteredAt: 11,
    returnedAt: 18,
    settledAt: 24,
    outcome: 'fulfilled',
    nextCalls: [
      { id: 0, calledAt: 13, returnedAt: 14, settledAt: 15, outcome: 'returned' },
      { id: 1, calledAt: 21, returnedAt: 22, settledAt: 23, outcome: 'fulfilled' },
    ],
  }],
}

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  if (root !== undefined) await act(async () => { root?.unmount() })
  host?.remove()
  root = undefined
  host = undefined
})

function render(onOpenFiber = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<ProfilerView status="enabled" traces={[trace]} onOpenFiber={onOpenFiber} />)
  })
  return { host, onOpenFiber }
}

describe('ProfilerView', () => {
  it('renders instrumentation state and expands repeated next facts', async () => {
    const { host } = render()
    expect(host.textContent).toContain('Waterfall Profiler')
    expect(host.textContent).toContain('enabled')
    expect(host.textContent).toContain('loader/entry-init')

    const traceButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('loader/entry-init'))
    expect(traceButton).toBeDefined()
    await act(async () => { traceButton!.click() })

    expect(host.textContent).toContain('loader-plugin')
    expect(host.textContent).toContain('next #1')
    expect(host.textContent).toContain('next #2')
    expect(host.textContent).not.toContain('short-circuit')
    expect(host.textContent).not.toContain('veto')
  })

  it('navigates to a listener owner through the rendered Pill', async () => {
    const onOpenFiber = vi.fn()
    const { host } = render(onOpenFiber)
    const traceButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('loader/entry-init'))
    await act(async () => { traceButton!.click() })

    const ownerButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent === 'loader-plugin')
    expect(ownerButton).toBeDefined()
    await act(async () => { ownerButton!.click() })
    expect(onOpenFiber).toHaveBeenCalledWith(7)
  })

  it('shows an explicit empty state without inventing trace conclusions', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root!.render(<ProfilerView status="disabled" traces={[]} />)
    })

    expect(host.textContent).toContain('disabled')
    expect(host.textContent).toContain('No waterfall traces in the current window.')
  })
})
