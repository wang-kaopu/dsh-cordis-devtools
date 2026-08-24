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

function render(onOpenFiber = vi.fn(), liveFiberUids: ReadonlySet<number> = new Set([7])) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <ProfilerView
        status="enabled"
        traces={[trace]}
        liveFiberUids={liveFiberUids}
        onOpenFiber={onOpenFiber}
      />,
    )
  })
  return { host, onOpenFiber }
}

function disclosure(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-trace-id="trace-1"] [data-disclosure-row]')
}

describe('ProfilerView', () => {
  it('renders instrumentation state and expands repeated next facts', async () => {
    const { host } = render()
    expect(host.textContent).toContain('Waterfall Profiler')
    expect(host.textContent).toContain('enabled')
    expect(host.textContent).toContain('loader/entry-init')

    const traceDisclosure = disclosure(host)
    expect(traceDisclosure).not.toBeNull()
    await act(async () => { traceDisclosure?.click() })

    expect(host.textContent).toContain('loader-plugin')
    expect(host.textContent).toContain('next #1')
    expect(host.textContent).toContain('next #2')
    expect(host.textContent).not.toContain('short-circuit')
    expect(host.textContent).not.toContain('veto')
  })

  it('navigates to a live listener owner through the rendered Pill', async () => {
    const onOpenFiber = vi.fn()
    const { host } = render(onOpenFiber)
    await act(async () => { disclosure(host)?.click() })

    const ownerButton = [...host.querySelectorAll<HTMLButtonElement>('[data-listener-span="span-1"] button')]
      .find(button => button.textContent === 'loader-plugin')
    expect(ownerButton).toBeDefined()
    await act(async () => { ownerButton?.click() })
    expect(onOpenFiber).toHaveBeenCalledWith(7)
  })

  it('keeps a historical listener owner visible but non-navigable after its Fiber is gone', async () => {
    const onOpenFiber = vi.fn()
    const { host } = render(onOpenFiber, new Set())
    await act(async () => { disclosure(host)?.click() })

    expect(host.textContent).toContain('loader-plugin')
    const ownerButton = [...host.querySelectorAll<HTMLButtonElement>('[data-listener-span="span-1"] button')]
      .find(button => button.textContent === 'loader-plugin')
    expect(ownerButton).toBeUndefined()
    expect(onOpenFiber).not.toHaveBeenCalled()
  })

  it('shows an explicit empty state without inventing trace conclusions', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root!.render(<ProfilerView status="disabled" traces={[]} liveFiberUids={new Set()} />)
    })

    expect(host.textContent).toContain('disabled')
    expect(host.textContent).toContain('No waterfall traces in the current window.')
  })

  it('identifies an Agent-owned lease and exposes only the Human emergency-stop action', async () => {
    const onSetInstrumentation = vi.fn()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <ProfilerView
          status="enabled"
          experiment={{
            generatedAt: 100,
            instrumentation: 'enabled',
            owner: {
              kind: 'agent',
              source: 'mcp',
              leaseId: 'lease-agent',
              startedAt: 100,
              expiresAt: Date.now() + 15_000,
            },
          }}
          traces={[]}
          liveFiberUids={new Set()}
          onSetInstrumentation={onSetInstrumentation}
        />,
      )
    })

    expect(host.querySelector('[data-testid="cordis-devtools-profiler-agent-owner"]')?.textContent)
      .toContain('Agent-owned mcp experiment')
    expect(host.textContent).toContain('Agent · mcp')
    const button = host.querySelector<HTMLButtonElement>('[data-testid="cordis-devtools-profiler-toggle"]')
    expect(button?.textContent).toBe('Stop Agent experiment')

    await act(async () => { button?.click() })
    expect(onSetInstrumentation).toHaveBeenCalledTimes(1)
    expect(onSetInstrumentation).toHaveBeenCalledWith(false)
  })
})
