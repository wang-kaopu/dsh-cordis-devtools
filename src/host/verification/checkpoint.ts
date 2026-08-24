import { createHash } from 'node:crypto'
import type { DevtoolsSnapshot, EffectSnapshot, FiberSnapshot } from '../../shared/types.js'
import {
  RUNTIME_CHECKPOINT_SCHEMA_VERSION,
  type RuntimeCheckpoint,
  type RuntimeCheckpointCaptureInput,
  type RuntimeCheckpointEffect,
  type RuntimeCheckpointFiberRef,
  type RuntimeCheckpointScope,
} from '../../shared/verification.js'

type CheckpointWithoutDigest = Omit<RuntimeCheckpoint, 'digest'>

export function captureRuntimeCheckpoint(
  snapshot: DevtoolsSnapshot,
  input: RuntimeCheckpointCaptureInput = {},
): RuntimeCheckpoint {
  const scope = normalizeCheckpointScope(input.scope)
  const eventSelectorPresent = scope.eventNames !== undefined
  const fiberSelectorPresent = scope.fiberNames !== undefined
  const captureAll = !eventSelectorPresent && !fiberSelectorPresent
  const eventNames = new Set(scope.eventNames ?? [])
  const fiberNames = new Set(scope.fiberNames ?? [])

  const listeners = snapshot.listeners.filter((listener) => {
    if (captureAll) return true
    if (eventNames.has(listener.event)) return true
    return listener.owner !== null && fiberNames.has(listener.owner.name)
  })

  const selectedOwnerUids = new Set(
    listeners
      .map(listener => listener.owner?.uid)
      .filter((uid): uid is number => typeof uid === 'number'),
  )

  const fibers = snapshot.fibers.filter((fiber) => {
    if (captureAll) return true
    return fiberNames.has(fiber.name) || selectedOwnerUids.has(fiber.uid)
  })

  const selectedEventNames = captureAll
    ? new Set(snapshot.events.map(event => event.name))
    : new Set([
        ...eventNames,
        ...listeners.map(listener => listener.event),
      ])

  const body: CheckpointWithoutDigest = {
    schemaVersion: RUNTIME_CHECKPOINT_SCHEMA_VERSION,
    capturedAt: snapshot.generatedAt,
    scope,
    events: snapshot.events
      .filter(event => selectedEventNames.has(event.name))
      .map(event => ({
        name: event.name,
        listenerCount: listeners.filter(listener => listener.event === event.name).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    listeners: listeners
      .map(listener => ({
        id: listener.id,
        event: listener.event,
        order: listener.order,
        prepend: listener.prepend,
        global: listener.global,
        owner: toCheckpointFiberRef(listener.owner),
      }))
      .sort(compareListeners),
    fibers: fibers
      .map(fiber => ({
        uid: fiber.uid,
        name: fiber.name,
        state: fiber.state,
        parent: toCheckpointFiberRef(fiber.parent),
        inject: sortedUnique(fiber.inject),
        ownedEvents: sortedUnique(
          listeners
            .filter(listener => listener.owner?.uid === fiber.uid)
            .map(listener => listener.event),
        ),
        effects: canonicalizeEffects(fiber.effects),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.uid - b.uid),
  }

  return {
    ...body,
    digest: computeRuntimeCheckpointDigest(body),
  }
}

export function computeRuntimeCheckpointDigest(
  checkpoint: RuntimeCheckpoint | CheckpointWithoutDigest,
): string {
  const { digest: _digest, ...body } = checkpoint as RuntimeCheckpoint
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

export function normalizeCheckpointScope(scope?: RuntimeCheckpointScope): RuntimeCheckpointScope {
  if (!scope) return {}
  return {
    ...('eventNames' in scope ? { eventNames: sortedUnique(scope.eventNames ?? []) } : {}),
    ...('fiberNames' in scope ? { fiberNames: sortedUnique(scope.fiberNames ?? []) } : {}),
  }
}

function toCheckpointFiberRef(fiber: FiberSnapshot | null): RuntimeCheckpointFiberRef | null {
  if (!fiber || fiber.uid === null) return null
  return {
    uid: fiber.uid,
    name: fiber.name,
    state: fiber.state,
  }
}

function canonicalizeEffects(effects: EffectSnapshot[]): RuntimeCheckpointEffect[] {
  return effects
    .map(effect => ({
      label: effect.label,
      children: canonicalizeEffects(effect.children),
    }))
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
}

function compareListeners(
  a: RuntimeCheckpoint['listeners'][number],
  b: RuntimeCheckpoint['listeners'][number],
): number {
  return a.event.localeCompare(b.event)
    || a.order - b.order
    || (a.owner?.name ?? '').localeCompare(b.owner?.name ?? '')
    || Number(a.prepend) - Number(b.prepend)
    || Number(a.global) - Number(b.global)
    || a.id - b.id
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`

  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort((a, b) => a.localeCompare(b))
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(',')}}`
}
