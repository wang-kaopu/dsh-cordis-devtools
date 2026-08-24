# Agent Note: Experiment trace association

Status: implemented

## Problem

The bounded profiler store can retain traces from earlier Human profiling and from multiple Agent experiments. An Agent lease therefore cannot identify “its” traces by timestamp or by assuming the store was empty when it started.

## Decision

`WaterfallDispatchTrace` gains optional metadata `experimentId` whose value is the Agent lease id that owned instrumentation when the trace was created.

The low-level controller accepts a transport-neutral `resolveExperimentId()` option and reads it exactly once at trace creation. The resulting field is then part of the trace object, so asynchronous settlement and late `next()` updates keep the original association even if the lease has already ended. If no Agent lease owns the seam, the field is omitted; Human/unowned traces never inherit a stale id.

`RuntimeProfilerTraceSearchInput` gains an optional exact `experimentId` filter. Filtering happens inside `RuntimeDiagnosticsQuery` and preserves existing bounded-window facts: `retained` still counts the bounded store, while `matched`, `returned`, and `truncated` describe the exact filtered result.

This workstream does not wire the controller to the coordinator yet. The later service-integration gate supplies `resolveExperimentId: () => coordinator.currentExperimentId()` so trace attribution and ownership come from the same authoritative state.

## Alternatives considered

### Infer experiment membership from startedAt/expiresAt timestamps

Rejected. Clock boundaries, late settlement, retained earlier traces, and adjacent leases make timestamp inference weaker than the exact owner id available at creation time.

### Retag traces while reading the profiler store

Rejected. Ownership must be fixed when the execution begins. Read-time tagging could associate a late-read older trace with whichever lease happens to be active now.

### Clear the profiler store whenever an experiment starts

Rejected. That destroys bounded Human/history evidence and still does not establish identity for late updates. Exact metadata association is cheaper and more truthful.

### Make experiment filtering imply complete capture

Rejected. The profiler store remains bounded and late facts can update retained traces. The existing `bounded / retained / matched / returned / truncated` contract remains authoritative.

## Consequences

Agent experiments can query an exact lease id without changing the privacy boundary or caller-visible waterfall behavior. Trace version remains `1` because the new field is optional metadata and existing readers remain structurally compatible; any future incompatible trace semantics still require an explicit version decision.
