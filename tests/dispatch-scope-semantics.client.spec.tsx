// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { TimelineView } from '../src/client/views/TimelineView.js'
import type { DispatchRecord } from '../src/shared/types.js'

describe('Timeline dispatch scope semantics', () => {
  it('renders a missing Cordis thisArg as no dispatch scope instead of an unknown producer context', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const dispatches: DispatchRecord[] = [{
      id: 1,
      timestamp: 1,
      mode: 'emit',
      event: 'agent/test',
      argCount: 0,
      registeredListeners: 1,
      thisFiber: null,
    }]
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <TimelineView
          dispatches={dispatches}
          expanded={new Set([1])}
          liveFiberUids={new Set()}
          onToggle={() => {}}
          onOpenFiber={() => {}}
        />,
      )
    })

    expect(container.textContent).toContain('Dispatch scope is the explicit Cordis thisArg when provided, not the producer Fiber.')
    expect(container.textContent).toContain('dispatch scope')
    expect(container.textContent).toContain('none')
    expect(container.textContent).not.toContain('dispatch context')
    expect(container.textContent).not.toContain('unknown')

    await act(async () => { root.unmount() })
  })
})
