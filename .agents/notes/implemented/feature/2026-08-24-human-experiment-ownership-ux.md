# Agent Note: Human profiler experiment ownership UX

Status: implemented

## Problem

After the Host started exposing v0.6 experiment ownership, the Profiler UI still rendered every `enabled` state as one ordinary Human toggle session. That could mislead a developer into thinking the Human UI owned an Agent lease and offered no explicit indication that the visible disable action was an emergency stop.

## Decision

`ProfilerView` consumes the optional `WaterfallProfilerSnapshot.experiment` facts supplied by the Host.

The visible control semantics are:

- disabled/no owner → `Enable profiling`;
- enabled/Human owner → `Disable profiling`;
- enabled/Agent owner → identify `Agent · dsh|mcp`, show factual expiry metadata, and label the only local action `Stop Agent experiment`.

The Agent-owned stop action uses the existing browser disable RPC. On the Host, Wave G maps that path to coordinator `forceStop()`, so the UI does not need a second emergency-stop transport.

The UI never offers a Human enable/takeover action while an Agent lease is active. It does not infer whether the experiment succeeded or whether captured traces are complete.

## Alternatives considered

### Keep the old enabled/disabled toggle and rely on documentation

Rejected. Ownership is runtime state and must be visible at the safety surface where a Human can terminate instrumentation.

### Add a new browser emergency-stop RPC

Rejected. The existing disable operation already has the approved Human emergency-stop semantics in the unified Host control layer; a second transport would duplicate mutation paths.

### Show only the lease id

Rejected. Source and expiry are the most useful Human-facing facts. The lease id remains available in machine-facing diagnostics/trace attribution and does not need to dominate the UI.

## Verification

DOM-level client tests render a real Agent ownership snapshot, verify source/ownership text and the explicit stop label, and assert the action requests `enabled=false`. Existing trace expansion and live-Fiber navigation tests remain unchanged; no source-string tests are added.
