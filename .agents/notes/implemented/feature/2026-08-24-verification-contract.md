# Agent Note: Runtime Verification shared contract

Status: implemented

## Problem

v0.5 needs one transport-neutral serialized contract before checkpoint projection, semantic diff, Cordis Inspect, and MCP can be implemented in parallel. If those branches invent their own checkpoint or comparison shapes, runtime-local identity rules and multiplicity semantics will drift across adapters.

## Decision

Add `src/shared/verification.ts` as the single v0.5 verification contract and export it from the package root.

The contract fixes schema version `1`, exact-name checkpoint scope, self-contained caller-owned checkpoints, capture-local listener/Fiber ids, metadata-only Effect trees, semantic listener/Fiber descriptors, and multiset-oriented event/listener/Fiber comparison rows.

`RuntimeCheckpointComparison` returns the current checkpoint plus structured changes and deliberately contains no `fixed`, `rootCause`, or confidence verdict. Runtime-local listener ids and Fiber uids remain present only as evidence within one capture; the semantic descriptor types exclude them from cross-checkpoint identity.

This PR defines types and the schema-version constant only. Checkpoint canonicalization/digest logic and semantic diff algorithms remain in the separate v0.5 implementation workstreams described by the approved roadmap.

## Alternatives considered

- Let checkpoint and diff PRs define their own local types and reconcile later. Rejected because both algorithms and both Agent adapters depend on the same serialized semantics.
- Reuse `DevtoolsSnapshot` as the checkpoint contract. Rejected because it contains bounded dispatch history and runtime-local representation details that should not become cross-reload verification identity.
- Store checkpoints behind Host-generated opaque ids. Rejected because v0.5 explicitly uses caller-owned self-contained values and avoids Host persistence/TTL/ownership state.

## Consequences

Downstream checkpoint, diff, DSH, and MCP branches can now share one public contract without contending on type design. The package gains a new public machine-facing type surface, so incompatible future checkpoint shapes must use a new schema version rather than silently reinterpreting version `1` values. No runtime collection, instrumentation, persistence, or target Cordis behavior changes in this PR.
