import { randomUUID } from 'node:crypto'
import type { WaterfallInstrumentationState } from '../../shared/trace.js'
import type { RuntimeNotificationSource } from '../runtime-notifications.js'
import {
  DEFAULT_WATERFALL_EXPERIMENT_TTL_MS,
  MAX_WATERFALL_EXPERIMENT_TTL_MS,
  type WaterfallControlOwner,
  type WaterfallExperimentId,
  type WaterfallExperimentSource,
  type WaterfallExperimentStartInput,
  type WaterfallExperimentStartResult,
  type WaterfallExperimentStatus,
  type WaterfallExperimentStopInput,
  type WaterfallExperimentStopResult,
} from '../../shared/experiments.js'

export interface WaterfallInstrumentationControl {
  /** Current authoritative state of the instrumentation seam. */
  readonly state: WaterfallInstrumentationState
  /** Attempts to acquire the instrumentation seam. */
  enable(): boolean
  /** Attempts to release the instrumentation seam. */
  disable(): boolean
}

export interface WaterfallExperimentCoordinatorOptions {
  /** Clock used for lease timestamps and status snapshots. */
  now?: () => number
  /** Factory for opaque Agent lease ids. */
  createLeaseId?: () => string
  /** Default Agent lease duration. */
  defaultTtlMs?: number
  /** Maximum Agent lease duration. */
  maxTtlMs?: number
  /** Optional Host-local source for metadata-only runtime notifications. */
  runtimeNotifications?: RuntimeNotificationSource
}

/** Owns Human and Agent ownership of the waterfall instrumentation seam. */
export class WaterfallExperimentCoordinator {
  private ownerValue: WaterfallControlOwner = { kind: 'none' }
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly createLeaseId: () => string
  private readonly defaultTtlMs: number
  private readonly maxTtlMs: number
  private readonly runtimeNotifications?: RuntimeNotificationSource

  /** Creates one coordinator around the authoritative instrumentation control. */
  constructor(
    private readonly instrumentation: WaterfallInstrumentationControl,
    options: WaterfallExperimentCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.createLeaseId = options.createLeaseId ?? randomUUID
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_WATERFALL_EXPERIMENT_TTL_MS
    this.maxTtlMs = options.maxTtlMs ?? MAX_WATERFALL_EXPERIMENT_TTL_MS
    this.runtimeNotifications = options.runtimeNotifications
    assertTtl(this.defaultTtlMs, this.maxTtlMs, 'defaultTtlMs')
    assertPositiveFinite(this.maxTtlMs, 'maxTtlMs')
  }

  /** Returns the current instrumentation and ownership facts. */
  status(): WaterfallExperimentStatus {
    return {
      generatedAt: this.now(),
      instrumentation: this.instrumentation.state,
      owner: cloneOwner(this.ownerValue),
    }
  }

  /** Returns the current Agent lease id, when an Agent owns instrumentation. */
  currentExperimentId(): WaterfallExperimentId | undefined {
    return this.ownerValue.kind === 'agent' ? this.ownerValue.leaseId : undefined
  }

  /** Attempts to start a finite Agent-owned waterfall experiment. */
  startAgent(
    source: WaterfallExperimentSource,
    input: WaterfallExperimentStartInput = {},
  ): WaterfallExperimentStartResult {
    const ttlMs = input.ttlMs ?? this.defaultTtlMs
    assertTtl(ttlMs, this.maxTtlMs, 'ttlMs')
    const beforeStatusSignature = this.statusSignature()

    if (this.ownerValue.kind !== 'none' || this.instrumentation.state === 'enabled') {
      return { outcome: 'busy', lease: null, status: this.status() }
    }
    if (this.instrumentation.state === 'unsupported') {
      return { outcome: 'unsupported', lease: null, status: this.status() }
    }
    if (this.instrumentation.state === 'conflict') {
      return { outcome: 'conflict', lease: null, status: this.status() }
    }
    if (!this.instrumentation.enable()) {
      const status = this.status()
      this.publishStatusIfChanged(beforeStatusSignature)
      return {
        outcome: status.instrumentation === 'unsupported' ? 'unsupported' : 'conflict',
        lease: null,
        status,
      }
    }

    const startedAt = this.now()
    const lease = {
      leaseId: this.createLeaseId(),
      source,
      startedAt,
      expiresAt: startedAt + ttlMs,
    }
    this.ownerValue = { kind: 'agent', ...lease }
    this.expiryTimer = setTimeout(() => this.expireLease(lease.leaseId), ttlMs)
    const status = this.status()
    this.publishStatusIfChanged(beforeStatusSignature)
    return { outcome: 'started', lease: { ...lease }, status }
  }

  /** Attempts to stop an Agent experiment using its exact lease id. */
  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult {
    if (this.ownerValue.kind !== 'agent') {
      return { outcome: 'not-active', status: this.status() }
    }
    if (this.ownerValue.leaseId !== input.leaseId) {
      return { outcome: 'lease-mismatch', status: this.status() }
    }

    const beforeStatusSignature = this.statusSignature()
    this.clearExpiryTimer()
    const disabled = this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    const status = this.status()
    this.publishStatusIfChanged(beforeStatusSignature)
    return {
      outcome: disabled ? 'stopped' : 'conflict',
      status,
    }
  }

  /** Starts a Human-owned waterfall experiment when the seam is free. */
  startHuman(): WaterfallExperimentStatus {
    if (this.ownerValue.kind !== 'none' || this.instrumentation.state !== 'disabled') {
      return this.status()
    }
    const beforeStatusSignature = this.statusSignature()
    if (this.instrumentation.enable()) {
      this.ownerValue = { kind: 'human' }
      const status = this.status()
      this.publishStatusIfChanged(beforeStatusSignature)
      return status
    }
    this.publishStatusIfChanged(beforeStatusSignature)
    return this.status()
  }

  /** Stops a Human-owned experiment when Human ownership is current. */
  stopHuman(): WaterfallExperimentStatus {
    if (this.ownerValue.kind !== 'human') return this.status()
    const beforeStatusSignature = this.statusSignature()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    const status = this.status()
    this.publishStatusIfChanged(beforeStatusSignature)
    return status
  }

  /** Human safety action: end whichever DevTools-owned session is current. */
  forceStop(): WaterfallExperimentStatus {
    if (this.ownerValue.kind === 'none') return this.status()
    const beforeStatusSignature = this.statusSignature()
    this.clearExpiryTimer()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    const status = this.status()
    this.publishStatusIfChanged(beforeStatusSignature)
    return status
  }

  /** Releases the current experiment and clears its expiry timer. */
  dispose(): void {
    this.clearExpiryTimer()
    if (this.ownerValue.kind === 'none') return
    const beforeStatusSignature = this.statusSignature()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    this.publishStatusIfChanged(beforeStatusSignature)
  }

  private expireLease(leaseId: string): void {
    this.expiryTimer = null
    if (this.ownerValue.kind !== 'agent' || this.ownerValue.leaseId !== leaseId) return
    const beforeStatusSignature = this.statusSignature()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    this.publishStatusIfChanged(beforeStatusSignature)
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer === null) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }

  private statusSignature(): string {
    return `${this.instrumentation.state}|${ownerSignature(this.ownerValue)}`
  }

  private publishStatusIfChanged(beforeStatusSignature: string): void {
    if (beforeStatusSignature === this.statusSignature()) return
    this.runtimeNotifications?.publish({
      type: 'profiler-status-changed',
      instrumentation: this.instrumentation.state,
    })
  }
}

function ownerSignature(owner: WaterfallControlOwner): string {
  if (owner.kind !== 'agent') return owner.kind
  return `${owner.kind}|${owner.leaseId}|${owner.source}|${owner.startedAt}|${owner.expiresAt}`
}

function cloneOwner(owner: WaterfallControlOwner): WaterfallControlOwner {
  return owner.kind === 'agent' ? { ...owner } : { ...owner }
}

function assertPositiveFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`)
  }
}

function assertTtl(value: number, max: number, field: string): void {
  assertPositiveFinite(value, field)
  if (value > max) throw new RangeError(`${field} must not exceed ${max}`)
}
