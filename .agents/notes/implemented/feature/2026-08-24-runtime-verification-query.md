# Agent Note: Runtime Verification query integration

Status: implemented

## Problem

Checkpoint projection and semantic diff are pure helpers, but DSH Cordis Inspect and MCP need one live query surface that captures the current authoritative observer state, validates caller-owned baselines, and performs the comparison consistently.

## Decision

Extend `RuntimeDiagnosticsQuery` with `captureCheckpoint()` and `compareCurrent()`.

`captureCheckpoint()` reads a fresh observer snapshot and delegates to the shared checkpoint projection. `compareCurrent()` requires a baseline checkpoint, rejects unsupported schema versions, verifies the baseline SHA-256 digest before using it, captures a fresh current checkpoint with the baseline's stored scope, and delegates to the semantic diff engine.

The query layer remains read-only with respect to the target Cordis runtime. It does not persist baselines, reload plugins, enable profiler instrumentation, or infer a fix/root cause.

## Alternatives considered

- Let Cordis Inspect and MCP each compose checkpoint/diff directly. Rejected because validation and fresh-current semantics would be duplicated across adapters.
- Store baselines inside `DevtoolsService` and compare by id. Rejected because v0.5 deliberately uses caller-owned self-contained checkpoints and avoids TTL/ownership/persistence state.
- Treat digest mismatch as a semantic change. Rejected because digest is an integrity check, not a cross-reload semantic identity mechanism.

## Consequences

Both Agent adapters can now delegate two additional methods to the same live Runtime Diagnostics Query surface. A tampered baseline fails before semantic comparison; runtime-local id/uid churn still remains invisible to semantic `changed` when topology descriptors and multiplicities are equal. Existing v0.4 read queries and profiler behavior are unchanged.
