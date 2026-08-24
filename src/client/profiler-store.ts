import type { WaterfallProfilerSnapshot } from '../shared/trace.js'
import type { ProfilerPort } from './profiler-port.js'

export interface ProfilerSnapshotState {
  snapshot?: WaterfallProfilerSnapshot
  loading: boolean
  stale: boolean
  mutating: boolean
  error?: string
}

export class ProfilerStore {
  private state: ProfilerSnapshotState = {
    loading: false,
    stale: false,
    mutating: false,
  }
  private readonly listeners = new Set<() => void>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private inFlight: AbortController | undefined
  private active = false
  private disposed = false

  constructor(
    private readonly port: ProfilerPort,
    private readonly pollIntervalMs = 1000,
  ) {}

  readonly getSnapshot = (): ProfilerSnapshotState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return
    this.active = active

    if (!active) {
      if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
      this.pollTimer = undefined
      const inFlight = this.inFlight
      inFlight?.abort()
      if (this.inFlight === inFlight) this.inFlight = undefined
      if (this.state.mutating) this.publish({ ...this.state, mutating: false })
      return
    }

    void this.refresh()
    this.pollTimer = setInterval(() => {
      void this.refresh({ background: true })
    }, this.pollIntervalMs)
  }

  async refresh({ background = false }: { background?: boolean } = {}): Promise<void> {
    if (this.disposed || this.inFlight !== undefined) return
    const controller = new AbortController()
    this.inFlight = controller
    if (!background) this.publish({ ...this.state, loading: true })

    try {
      const snapshot = await this.port.fetchSnapshot(controller.signal)
      if (controller.signal.aborted || this.disposed) return
      this.publish({ snapshot, loading: false, stale: false, mutating: false })
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

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed || this.state.mutating) return

    const previous = this.inFlight
    previous?.abort()
    if (this.inFlight === previous) this.inFlight = undefined

    const controller = new AbortController()
    this.inFlight = controller
    this.publish({ ...this.state, loading: false, mutating: true })

    try {
      const snapshot = await this.port.setEnabled(enabled, controller.signal)
      if (controller.signal.aborted || this.disposed) return
      this.publish({ snapshot, loading: false, stale: false, mutating: false })
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      this.publish({
        ...this.state,
        loading: false,
        mutating: false,
        stale: this.state.snapshot !== undefined,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.setActive(false)
    this.disposed = true
    this.listeners.clear()
  }

  private publish(next: ProfilerSnapshotState): void {
    this.state = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-cordis-devtools] profiler subscriber threw:', error)
      }
    }
  }
}
