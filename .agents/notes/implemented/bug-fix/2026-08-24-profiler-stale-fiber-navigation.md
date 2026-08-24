# Agent Note: Keep historical Profiler Fiber owners non-navigable

Status: implemented

## Problem

Profiler traces retain listener owner metadata after the owning Fiber may have been disposed. The Profiler view previously rendered every owner with a non-null uid as a clickable Pill whenever an `onOpenFiber` handler existed. `DevtoolsShell` rejected stale uids inside `openFiber()`, so clicking a historical owner silently did nothing even though the UI still presented it as navigable.

This conflicted with the existing cross-view rule that current `DevtoolsSnapshot.fibers` is authoritative for navigation while historical Fiber references remain readable metadata only.

## Decision

`DevtoolsShell` passes its existing `liveFiberUids` set into `ProfilerView`. A Profiler listener owner is rendered as a clickable Pill only when all of the following are true:

- the trace owner has a uid;
- that uid exists in the current live Fiber inventory;
- an `onOpenFiber` handler is available.

Otherwise the owner name remains visible as plain metadata. No trace contract, retention behavior, instrumentation semantics, or Fiber snapshot data changes.

## Alternatives considered

### Keep every non-null owner uid clickable and rely on `openFiber()` to reject stale references

Rejected because the rendered affordance promises navigation that cannot succeed. The Shell guard remains useful as defense in depth, but it should not be the first place stale references are detected.

### Use the historical `owner.state` stored in the profiler trace

Rejected because trace owner metadata is historical and is not authoritative current runtime state. A Fiber can disappear after the trace was recorded, so navigation must be decided from the live Fiber inventory.

## Consequences

Live Profiler owners continue to navigate to Fibers exactly as before. Disposed/historical owners remain inspectable in the trace but no longer look interactive. The regression is covered with a DOM-level ProfilerView test that verifies a live owner renders as a navigable Pill while the same historical owner becomes plain metadata when its uid is absent from `liveFiberUids`.
