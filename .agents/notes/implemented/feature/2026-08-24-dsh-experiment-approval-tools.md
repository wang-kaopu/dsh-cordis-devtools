# Agent Note: DSH approved waterfall experiment tools

Status: implemented

## Problem

`CordisRuntime` is intentionally a read-only inspection Provider, but v0.6 needs a DSH-native Agent path that can request the one approved runtime mutation. Reusing inspect would bypass the normal ToolRuntime execution identity and would not carry a real Agent/call id into the existing approval seam.

## Decision

v0.6 uses a dedicated DSH tool pair:

- `cordis_start_waterfall_experiment`
- `cordis_stop_waterfall_experiment`

The adapter is transport/authority code only and targets an abstract experiment-control interface. Live coordinator wiring is deferred to the second fan-out.

The start tool validates local argument shape, requires a real calling Agent, resolves the optional `ctx.approval` service, and asks exactly once before invoking coordinator mutation. The request carries the real Agent, current call id when present, caller signal, tool name, and a human-readable finite-duration reason. Only `allowed-once` reaches `startAgent('dsh', ...)`. Rejected, cancelled, unavailable, missing approval service, approval failure, or missing Agent identity returns `approval-denied` and never calls the coordinator.

The stop tool does not ask again. It delegates only an exact lease id to the coordinator, where owner matching is authoritative. This makes stop a cleanup operation rather than a second grant.

The adapter registers definitions through the existing `tools` service when that service is composed. It does not add mutation methods to `CordisRuntime` and does not introduce a second approval mechanism.

## Alternatives considered

### Add start/stop to CordisRuntime inspect

Rejected. Cordis Inspect is model-visible read-only capability discovery/query. Mutation there would erase the DSH ToolRuntime call identity and contradict the v0.4/v0.5 inspect contract.

### Rely only on a `tools/pre-execute` ask decision

Rejected as the mandatory v0.6 authority boundary. That waterfall is intentionally reorderable. The start body itself asks through `ctx.approval` immediately before mutation so a successful tool dispatch cannot bypass the required one-shot decision.

### Ask again when stopping

Rejected. A matching stop reduces runtime mutation and cannot affect a Human or different Agent lease because the coordinator checks exact ownership.

### Invent an approval service inside this plugin

Rejected. DSH already owns answer routing, fail-closed absence, session policy, cancellation, and approval audit semantics. The adapter consumes that seam rather than duplicating it.

## Consequences

The first implementation is testable without a live ToolRuntime by exercising the two complete tool definitions and a structural approval/control seam. Later H1 wiring must prove the same definitions through real DSH ToolRuntime + real `ctx.approval` with an open turn and keyless scripted answerer. Tool registration remains scoped to the owning Cordis lifecycle.
