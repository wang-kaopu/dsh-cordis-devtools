import type { WaterfallInstrumentationState } from '../shared/trace.js'

/** Metadata-only dispatch fact emitted before a Cordis dispatch executes. */
export interface RuntimeDispatchNotification {
  type: 'dispatch-observed'
  dispatchId: number
  event: string
  mode: string
  argCount: number
  registeredListeners: number
}

/** Metadata-only signal that an authoritative runtime topology query is stale. */
export interface RuntimeTopologyInvalidatedNotification {
  type: 'topology-invalidated'
  reason: 'event-listeners' | 'fibers' | 'snapshot'
}

/** Metadata-only signal that a retained waterfall trace has changed. */
export interface RuntimeProfilerTraceUpdatedNotification {
  type: 'profiler-trace-updated'
  traceId: string
  event: string
}

/** Metadata-only signal that profiler instrumentation ownership/state changed. */
export interface RuntimeProfilerStatusChangedNotification {
  type: 'profiler-status-changed'
  instrumentation: WaterfallInstrumentationState
}

/**
 * Host-local runtime fact emitted before the Agent Debug journal adds its
 * target-local sequence and observation timestamp.
 */
export type RuntimeNotification =
  | RuntimeDispatchNotification
  | RuntimeTopologyInvalidatedNotification
  | RuntimeProfilerTraceUpdatedNotification
  | RuntimeProfilerStatusChangedNotification

/** Callback invoked for each notification published by a runtime source. */
export type RuntimeNotificationListener = (notification: RuntimeNotification) => void

/** Disposes one lifecycle-owned runtime notification subscription. */
export type RuntimeNotificationDisposer = () => void

/**
 * Host-local fan-out source for metadata-only runtime observations.
 *
 * The source deliberately has no transport or retention semantics. A journal
 * can subscribe to it and own bounded storage, while a collector, trace store,
 * or coordinator can publish facts without knowing which consumers exist.
 */
export class RuntimeNotificationSource {
  private readonly listeners = new Set<RuntimeNotificationListener>()
  private disposed = false

  /**
   * Subscribes a lifecycle owner to future runtime notifications.
   *
   * @param listener - Consumer that receives metadata-only runtime facts
   * @returns An idempotent disposer owned by the subscribing lifecycle
   */
  subscribe(listener: RuntimeNotificationListener): RuntimeNotificationDisposer {
    if (this.disposed) return () => {}

    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  /**
   * Publishes one metadata-only runtime fact to the current subscribers.
   *
   * Subscribers are snapshotted before dispatch so a listener may safely
   * dispose itself or another subscription while handling a notification.
   * Publishing after source disposal is ignored because the owning runtime is
   * no longer able to produce meaningful observations.
   *
   * @param notification - Runtime fact to fan out
   */
  publish(notification: RuntimeNotification): void {
    if (this.disposed) return
    for (const listener of [...this.listeners]) listener(notification)
  }

  /**
   * Disposes the source and all remaining subscriptions.
   *
   * Future subscriptions and publications become no-ops. Existing disposer
   * functions remain safe to call after disposal.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
  }

  /** Whether this source has been disposed by its owning runtime lifecycle. */
  get isDisposed(): boolean {
    return this.disposed
  }
}
