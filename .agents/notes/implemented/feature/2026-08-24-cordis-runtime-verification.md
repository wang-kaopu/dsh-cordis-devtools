# Agent Note: CordisRuntime verification adapter

Status: implemented

## Problem

The in-process DSH Agent already discovers `CordisRuntime` through first-party Cordis Inspect. v0.5 verification should extend that existing provider rather than introduce a second package-specific tool family or route DSH back through loopback MCP.

## Decision

Add `captureCheckpoint` and `compareCurrent` to the existing `CordisRuntime` provider manifest and delegate both directly to `RuntimeDiagnosticsQuery`.

`captureCheckpoint` accepts optional exact-name `eventNames` / `fiberNames` scope arrays. `compareCurrent` accepts the caller-owned baseline checkpoint object returned by `captureCheckpoint`. The adapter validates only protocol/input shape; schema-version, digest, fresh-current capture, and semantic comparison remain owned by Runtime Diagnostics Query.

The provider remains optional behind DSH `cordisInspect`, lifecycle-owned, and read-only with respect to the target Cordis runtime.

## Alternatives considered

- Register dedicated DSH tools for checkpoint and compare. Rejected because DSH already owns the generic `cordis_inspect_list` / `cordis_inspect_query` path.
- Route DSH through the embedded MCP endpoint. Rejected because that adds a network/protocol dependency without gaining runtime facts.
- Reimplement checkpoint validation/diff in the provider. Rejected because adapters must remain thin and share one verification implementation.

## Consequences

DSH Agents can discover seven `CordisRuntime` methods and carry a checkpoint value across a normal edit/reload cycle, then ask the same provider to compare it with current runtime state. No instrumentation, persistence, reload control, or new sensitive payload capture is introduced.
