import { RUNTIME_CHECKPOINT_SCHEMA_VERSION, type RuntimeCheckpoint, type RuntimeCheckpointComparison, type RuntimeCheckpointEffect, type RuntimeFiberSemanticDescriptor, type RuntimeListenerSemanticDescriptor } from '../../shared/verification.js'

export function compareRuntimeCheckpoints(
  baseline: RuntimeCheckpoint,
  current: RuntimeCheckpoint,
): RuntimeCheckpointComparison {
  assertComparableCheckpoints(baseline, current)

  const events = compareEvents(baseline, current)
  const listenerGroups = compareGroups(
    baseline.listeners.map(listenerDescriptor),
    current.listeners.map(listenerDescriptor),
  ).map(group => ({ ...group, descriptor: group.descriptor as RuntimeListenerSemanticDescriptor }))
  const fiberGroups = compareGroups(
    baseline.fibers.map(fiberDescriptor),
    current.fibers.map(fiberDescriptor),
  ).map(group => ({ ...group, descriptor: group.descriptor as RuntimeFiberSemanticDescriptor }))

  return {
    changed: events.length > 0 || listenerGroups.length > 0 || fiberGroups.length > 0,
    baselineDigest: baseline.digest,
    current,
    events,
    listenerGroups,
    fiberGroups,
  }
}

function assertComparableCheckpoints(baseline: RuntimeCheckpoint, current: RuntimeCheckpoint): void {
  if (baseline.schemaVersion !== RUNTIME_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(`Unsupported baseline checkpoint schema version: ${baseline.schemaVersion}`)
  }
  if (current.schemaVersion !== RUNTIME_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(`Unsupported current checkpoint schema version: ${current.schemaVersion}`)
  }
  if (scopeKey(baseline) !== scopeKey(current)) {
    throw new Error('Runtime checkpoint scope mismatch')
  }
}

function compareEvents(baseline: RuntimeCheckpoint, current: RuntimeCheckpoint) {
  const before = new Map(baseline.events.map(event => [event.name, event.listenerCount]))
  const after = new Map(current.events.map(event => [event.name, event.listenerCount]))
  const names = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b))

  return names.flatMap((name) => {
    const beforeListenerCount = before.get(name) ?? 0
    const afterListenerCount = after.get(name) ?? 0
    if (beforeListenerCount === afterListenerCount) return []
    return [{
      name,
      beforeListenerCount,
      afterListenerCount,
      delta: afterListenerCount - beforeListenerCount,
    }]
  })
}

function listenerDescriptor(listener: RuntimeCheckpoint['listeners'][number]): RuntimeListenerSemanticDescriptor {
  return {
    event: listener.event,
    ownerName: listener.owner?.name ?? null,
    order: listener.order,
    prepend: listener.prepend,
    global: listener.global,
  }
}

function fiberDescriptor(fiber: RuntimeCheckpoint['fibers'][number]): RuntimeFiberSemanticDescriptor {
  return {
    name: fiber.name,
    state: fiber.state,
    parentName: fiber.parent?.name ?? null,
    inject: sortedUnique(fiber.inject),
    ownedEvents: sortedUnique(fiber.ownedEvents),
    effects: canonicalizeEffects(fiber.effects),
  }
}

function compareGroups<T extends RuntimeListenerSemanticDescriptor | RuntimeFiberSemanticDescriptor>(
  beforeDescriptors: T[],
  afterDescriptors: T[],
) {
  const before = countDescriptors(beforeDescriptors)
  const after = countDescriptors(afterDescriptors)
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b))

  return keys.flatMap((key) => {
    const beforeEntry = before.get(key)
    const afterEntry = after.get(key)
    const beforeCount = beforeEntry?.count ?? 0
    const afterCount = afterEntry?.count ?? 0
    if (beforeCount === afterCount) return []
    return [{
      descriptor: (beforeEntry?.descriptor ?? afterEntry?.descriptor) as T,
      beforeCount,
      afterCount,
      delta: afterCount - beforeCount,
    }]
  })
}

function countDescriptors<T extends RuntimeListenerSemanticDescriptor | RuntimeFiberSemanticDescriptor>(descriptors: T[]) {
  const groups = new Map<string, { descriptor: T, count: number }>()
  for (const descriptor of descriptors) {
    const key = canonicalStringify(descriptor)
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { descriptor, count: 1 })
  }
  return groups
}

function scopeKey(checkpoint: RuntimeCheckpoint): string {
  return canonicalStringify({
    ...('eventNames' in checkpoint.scope ? { eventNames: sortedUnique(checkpoint.scope.eventNames ?? []) } : {}),
    ...('fiberNames' in checkpoint.scope ? { fiberNames: sortedUnique(checkpoint.scope.fiberNames ?? []) } : {}),
  })
}

function canonicalizeEffects(effects: RuntimeCheckpointEffect[]): RuntimeCheckpointEffect[] {
  return effects
    .map(effect => ({ label: effect.label, children: canonicalizeEffects(effect.children) }))
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
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
