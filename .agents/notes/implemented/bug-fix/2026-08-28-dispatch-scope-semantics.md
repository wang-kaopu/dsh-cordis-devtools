# Agent Note: Correct Dispatch Scope Semantics

Status: implemented

## Problem

Timeline labeled `DispatchRecord.thisFiber` as `dispatch context` and rendered a missing value as `unknown`. That presentation implied DevTools expected to know the Context/Fiber that produced the event but had failed to collect it.

Cordis `internal/dispatch` does not expose the producer Fiber. Its fourth argument is the explicit dispatch `thisArg`, which is used as listener `this` and may participate in context filtering. Ordinary calls such as `ctx.emit('event', payload)` usually do not provide that value, so `null` is the normal and meaningful state rather than an observation failure.

## Decision

Keep the serialized `DispatchRecord.thisFiber` field for compatibility, but define it explicitly as the Fiber projection of Cordis dispatch `thisArg`, not the caller or producer Fiber.

Timeline now presents that value as `dispatch scope`. A missing value is rendered as `none`, and the Timeline notice states that dispatch scope is the explicit Cordis `thisArg` when provided and is not the producer Fiber.

The collector also names its local projection `dispatchScope` and documents the distinction at the `internal/dispatch` observation boundary.

## Consequences

The existing Host/MCP snapshot contract remains wire-compatible, while the Web UI no longer suggests that a normal `null` scope is an instrumentation failure.

This change does not add producer attribution. If producer Fiber, plugin, or callsite attribution is required later, it needs separate instrumentation and a separately named field such as `origin` or `producerFiber`; it must not be inferred from Cordis `thisArg`.

## Alternatives considered

Removing `thisFiber` from the serialized contract was rejected because it would
break existing snapshots and consumers. Treating `thisArg` as the producer
Fiber was rejected because Cordis does not expose that fact and the resulting
diagnostic would be invented rather than observed.
