import type { DevtoolsSnapshot } from '../shared/types.js'
import type { SnapshotPort } from './port.js'

export interface ExplorerSnapshotState {
  snapshot?: DevtoolsSnapshot
  loading: boolean
  stale: boolean
  error?: string
}

export class EventExplorerStore {
  private state: ExplorerSnapshotState = {
    loading: false,
    stale: false,
  }
  private readonly listeners = new Set<() => void>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private inFlight: AbortController | undefined
  private open = false
  private disposed = false

  constructor(
    private readonly port: SnapshotPort,
    private readonly pollIntervalMs = 1000,
  ) {}

  readonly getSnapshot = (): ExplorerSnapshotState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setOpen(open: boolean): void {
    if (this.disposed || this.open === open) return
    this.open = open

    if (!open) {
      if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
      this.pollTimer = undefined
      const inFlight = this.inFlight
      inFlight?.abort()
      if (this.inFlight === inFlight) this.inFlight = undefined
      return
    }

    void this.refresh()
    this.pollTimer = setInterval(() => {
      void this.refresh()
    }, this.pollIntervalMs)
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.inFlight !== undefined) return

    const controller = new AbortController()
    this.inFlight = controller
    this.publish({
      ...this.state,
      loading: true,
    })

    try {
      const snapshot = await this.port.fetchSnapshot(controller.signal)
      if (controller.signal.aborted || this.disposed) return
      this.publish({
        snapshot,
        loading: false,
        stale: false,
      })
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      this.publish({
        ...this.state,
        loading: false,
        stale: this.state.snapshot !== undefined,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.setOpen(false)
    this.disposed = true
    this.listeners.clear()
  }

  private publish(next: ExplorerSnapshotState): void {
    this.state = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-cordis-devtools] snapshot subscriber threw:', error)
      }
    }
  }
}
