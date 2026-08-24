import { randomUUID } from 'node:crypto'
import type { WaterfallInstrumentationState } from '../../shared/trace.js'
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
  readonly state: WaterfallInstrumentationState
  enable(): boolean
  disable(): boolean
}

export interface WaterfallExperimentCoordinatorOptions {
  now?: () => number
  createLeaseId?: () => string
  defaultTtlMs?: number
  maxTtlMs?: number
}

export class WaterfallExperimentCoordinator {
  private ownerValue: WaterfallControlOwner = { kind: 'none' }
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly createLeaseId: () => string
  private readonly defaultTtlMs: number
  private readonly maxTtlMs: number

  constructor(
    private readonly instrumentation: WaterfallInstrumentationControl,
    options: WaterfallExperimentCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.createLeaseId = options.createLeaseId ?? randomUUID
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_WATERFALL_EXPERIMENT_TTL_MS
    this.maxTtlMs = options.maxTtlMs ?? MAX_WATERFALL_EXPERIMENT_TTL_MS
    assertTtl(this.defaultTtlMs, this.maxTtlMs, 'defaultTtlMs')
    assertPositiveFinite(this.maxTtlMs, 'maxTtlMs')
  }

  status(): WaterfallExperimentStatus {
    return {
      generatedAt: this.now(),
      instrumentation: this.instrumentation.state,
      owner: cloneOwner(this.ownerValue),
    }
  }

  currentExperimentId(): WaterfallExperimentId | undefined {
    return this.ownerValue.kind === 'agent' ? this.ownerValue.leaseId : undefined
  }

  startAgent(
    source: WaterfallExperimentSource,
    input: WaterfallExperimentStartInput = {},
  ): WaterfallExperimentStartResult {
    const ttlMs = input.ttlMs ?? this.defaultTtlMs
    assertTtl(ttlMs, this.maxTtlMs, 'ttlMs')

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
    return { outcome: 'started', lease: { ...lease }, status: this.status() }
  }

  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult {
    if (this.ownerValue.kind !== 'agent') {
      return { outcome: 'not-active', status: this.status() }
    }
    if (this.ownerValue.leaseId !== input.leaseId) {
      return { outcome: 'lease-mismatch', status: this.status() }
    }

    this.clearExpiryTimer()
    const disabled = this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    return {
      outcome: disabled ? 'stopped' : 'conflict',
      status: this.status(),
    }
  }

  startHuman(): WaterfallExperimentStatus {
    if (this.ownerValue.kind !== 'none' || this.instrumentation.state !== 'disabled') {
      return this.status()
    }
    if (this.instrumentation.enable()) {
      this.ownerValue = { kind: 'human' }
    }
    return this.status()
  }

  stopHuman(): WaterfallExperimentStatus {
    if (this.ownerValue.kind !== 'human') return this.status()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    return this.status()
  }

  /** Human safety action: end whichever DevTools-owned session is current. */
  forceStop(): WaterfallExperimentStatus {
    if (this.ownerValue.kind === 'none') return this.status()
    this.clearExpiryTimer()
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
    return this.status()
  }

  dispose(): void {
    this.clearExpiryTimer()
    if (this.ownerValue.kind !== 'none') {
      this.instrumentation.disable()
      this.ownerValue = { kind: 'none' }
    }
  }

  private expireLease(leaseId: string): void {
    this.expiryTimer = null
    if (this.ownerValue.kind !== 'agent' || this.ownerValue.leaseId !== leaseId) return
    this.instrumentation.disable()
    this.ownerValue = { kind: 'none' }
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer === null) return
    clearTimeout(this.expiryTimer)
    this.expiryTimer = null
  }
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
