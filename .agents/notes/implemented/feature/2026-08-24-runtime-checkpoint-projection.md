# Agent Note: Runtime checkpoint projection

Status: implemented

## Problem

v0.5 needs a deterministic, self-contained checkpoint value derived from current authoritative observer topology. Reusing `DevtoolsSnapshot` directly would accidentally include bounded dispatch history and unstable ordering, while ad-hoc per-adapter projection would drift between DSH and MCP.

## Decision

Add a pure Host verification helper that projects `DevtoolsSnapshot` into schema-versioned `RuntimeCheckpoint` values.

The projection normalizes exact-name scope selectors, applies union semantics, keeps event/listener/Fiber relationships one hop deep, and recomputes event listener counts inside the selected checkpoint scope. Selected event listeners pull in their current live owner Fibers; selected Fiber names pull in their owned current listeners/events.

Inject names, owned event names, Effect trees, events, listeners, and Fibers are canonicalized into deterministic ordering before the checkpoint digest is computed. The digest is SHA-256 over the complete checkpoint body except the digest field itself. `capturedAt` and capture-local id/uid evidence remain part of that body; semantic cross-checkpoint equality is deliberately left to the separate diff engine rather than inferred from digest equality.

Bounded dispatch history is excluded completely.

## Alternatives considered

- Hash or serialize `DevtoolsSnapshot` directly. Rejected because dispatch history is bounded evidence and does not belong in authoritative verification topology.
- Expand event/Fiber scope recursively through every related object. Rejected because v0.5 explicitly requires deterministic one-hop closure rather than arbitrary graph crawling.
- Make digest ignore all capture-local evidence. Rejected because the digest is an integrity hash for the serialized checkpoint value; semantic equality across reload belongs to the diff descriptor/multiset layer.

## Consequences

Checkpoint creation is deterministic for equivalent authoritative topology regardless of source array ordering. Explicit empty selectors remain distinct from omitted selectors. DSH/MCP/query integration can reuse this helper without adding persistence or target-runtime mutation. Runtime-local ids may still make exact checkpoint digests differ across reloads, but the later semantic diff must not treat that churn as a runtime topology change by itself.
