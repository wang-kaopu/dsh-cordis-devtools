# Agent Note: Runtime Verification checkpoints and semantic diff

Status: implemented

## Problem

v0.4 gives the DSH Agent and external MCP clients access to authoritative live Cordis runtime facts, but verification after a code change was still manual: callers had to issue multiple queries before and after a change and invent their own rules for runtime-local ids, duplicate Fibers/listeners, and bounded history.

That is unsafe across lifecycle changes. Fiber uids and listener ids are capture-local evidence, not stable cross-checkpoint identities. Bounded dispatch/profiler history also has weaker guarantees than current listener/Fiber inventory and cannot be compared as authoritative topology.

## Decision

v0.5 adds a transport-neutral Runtime Verification layer above `RuntimeDiagnosticsQuery`.

Two read-only operations are implemented:

- `captureCheckpoint(scope?)` returns a versioned, self-contained, serializable projection of current authoritative topology;
- `compareCurrent({ baseline })` validates the caller-supplied checkpoint, captures fresh current topology with the same scope, and returns a structured semantic diff plus the current checkpoint.

Checkpoints are caller-owned values. The Host does not allocate checkpoint ids, TTLs, persistence, ownership, or disconnect cleanup state.

Checkpoint topology contains current Events/listeners/live Fibers and metadata-only Effect structure. Bounded dispatch records and profiler traces remain separate read paths and are excluded from authoritative checkpoint topology.

The v1 digest is computed over canonical checkpoint content and validated before comparison. It is an integrity/equality field, not object identity.

Cross-checkpoint comparison is multiplicity-preserving:

- Listener semantic descriptors use event, owner Fiber name/no owner, `prepend`, and `global`.
- Listener id, owner uid, and registration `order` remain capture-local evidence and are excluded from the semantic key.
- Fiber semantic descriptors exclude uid and use canonical factual metadata including name, state, parent name, inject names, owned events, and metadata-only Effect structure.
- Equal descriptors are compared as multiset counts, so duplicate topology can be represented as `2 → 1` without arbitrary instance pairing.

Registration `order` was intentionally removed from listener semantic identity after the real DSH verification proof showed that equivalent duplicate registrations naturally occupy different order positions. Keeping `order` in the key split a real duplicate pair into unrelated `1`-count groups. The checkpoint still preserves `order` as factual evidence for a single capture.

The same verification implementation is exposed through:

- the existing DSH `CordisRuntime` Inspect Provider as `captureCheckpoint` / `compareCurrent`;
- embedded MCP as `cordis_capture_checkpoint` / `cordis_compare_current`.

Adapters delegate to `RuntimeDiagnosticsQuery` and do not implement independent checkpoint/diff algorithms.

v0.5 remains read-only with respect to the target runtime. Automatic reload, profiler mutation/leases, and root-cause/fix/confidence verdicts remain outside this decision.

## Alternatives considered

### Let the model compare repeated targeted queries itself

Rejected. It duplicates matching rules across Agents, creates id/uid/order noise, and risks treating bounded history as stronger evidence than it is.

### Store checkpoints server-side and return opaque ids

Rejected for v0.5. It would introduce retention, TTL, ownership, multi-Agent isolation, persistence/restart behavior, and disconnect cleanup that are unnecessary for caller-held before/after verification.

### Match runtime objects by listener id or Fiber uid

Rejected. Those identifiers are runtime-local and are not stable semantic identity across lifecycle changes.

### Include listener registration order in the semantic key

Rejected by real DSH evidence. Duplicate equivalent listener registrations have distinct runtime order positions, so `order` prevents multiplicity grouping. It remains capture-local evidence only.

### Compare full observer/profiler snapshots byte-for-byte

Rejected. Runtime-local ids/order and retained histories create noise, while dispatch/profiler history is not authoritative current topology.

### Add `fixed`, `rootCause`, confidence, automatic reload, or profiler mutation

Rejected for v0.5. Runtime Verification returns mechanical facts. Interpretation and code-changing workflow remain outside the diagnostics contract, while profiler mutation requires a separate permission/lease/cleanup design.

## Consequences

- DSH and MCP share one canonical checkpoint/diff semantics instead of reimplementing comparison independently.
- Callers can carry a baseline through the normal edit/reload workflow without Host persistence state.
- Runtime-local listener id/order and Fiber/owner uid remain useful evidence inside a checkpoint but do not create false cross-checkpoint identity.
- Duplicate Listener/Fiber topology remains count-preserving and can express `2 → 1`.
- `compareCurrent` rejects unsupported/tampered baselines instead of guessing compatibility.
- Bounded dispatch/profiler histories keep their weaker occurrence-history semantics and stay outside checkpoints.
- Raw event arguments, return values, errors, prompts, tool results, files, config, credentials, and raw Effect functions/disposers remain outside the verification contract.
- A deterministic real DSH E2E proves that DSH Cordis Inspect and an external official MCP Client can independently carry baselines across the same real Cordis `2 → 1` lifecycle transition and recover equivalent Event/Listener/Fiber semantic evidence while the Human DevTools and waterfall Profiler remain healthy.
- Controlled runtime experiments remain a later architectural decision rather than being implied by v0.5 verification.