import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'

describe('client entry', () => {
  it('registers additively in sidebar.footer.action and disposes its store with the client fiber', () => {
    let registration: { name: string; id?: string; order?: number } | undefined
    let dispose: (() => void) | undefined

    const slots = {
      inject: vi.fn((name: string, callback: () => unknown) => {
        expect(name).toBe('sidebar.footer.action')
        return callback()
      }),
      register: vi.fn((options: { name: string; id?: string; order?: number }) => {
        registration = options
        return () => {}
      }),
    }
    const connection = {
      rpc: {
        call: vi.fn(),
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'slots') return slots
        if (name === 'connection') return connection
        return undefined
      },
      effect(factory: () => (() => void), _label?: string) {
        dispose = factory()
        return dispose
      },
    } as unknown as Context

    apply(ctx)

    expect(registration).toMatchObject({
      name: 'sidebar.footer.action',
      id: 'cordis-devtools',
      order: 100,
    })
    expect(slots.register).toHaveBeenCalledTimes(1)
    expect(dispose).toBeTypeOf('function')
    dispose?.()
  })
})
