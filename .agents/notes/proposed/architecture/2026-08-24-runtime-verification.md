# Agent Note: Runtime Verification checkpoints and semantic diff

Status: proposed

## Problem

v0.4 gives the DSH Agent and external MCP clients access to authoritative live Cordis runtime facts, but verification after a code change is still manual: an Agent must issue multiple targeted queries before and after the change, remember the earlier values, and decide how to compare runtime-local ids, duplicate Fibers/listeners, and bounded history.

That is especially fragile across plugin reloads. Fiber uids and listener ids are runtime-local evidence, not stable cross-checkpoint identities. A naive diff can report noise from id churn or collapse duplicate semantic instances into one row. Bounded dispatch/profiler history also has weaker guarantees than current listener/Fiber inventory and must not be compared as if it were authoritative state.

The project needs a shared, transport-neutral verification contract so DSH Cordis Inspect and MCP produce the same before/after facts without moving root-cause reasoning into the diagnostics layer.

## Proposal

Add a v0.5 Runtime Verification layer above the existing Runtime Diagnostics Query.

The layer provides two logical read operations:

- `captureCheckpoint(scope?)` — return a versioned, self-contained, serializable projection of current authoritative runtime topology;
- `compareCurrent({ baseline })` — validate the supplied checkpoint, recapture the same scope from the current runtime, and return a structured semantic diff plus the current checkpoint.

Checkpoints are caller-owned values rather than Host-persistent ids. They include a schema version, exact-name scope, canonical semantic payload, and digest. The Host therefore does not need checkpoint TTL, persistence, ownership, or disconnect cleanup, and a caller can keep a baseline across plugin reload/Host restart.

Checkpoint topology includes current events/listeners/live Fibers and metadata-only Effect structure needed for verification. Runtime-local ids/uids may remain as capture-local navigation evidence, but cross-checkpoint matching excludes them.

Semantic matching is multiplicity-preserving. Listener groups use stable observable metadata such as event, owner name, order, `prepend`, and `global`; Fiber descriptors use metadata such as name, normalized state, parent name, sorted inject names, sorted owned event names, and canonical metadata-only Effect labels/paths. Equal descriptors are compared as multiset counts so duplicate runtime instances remain visible as `2 → 1` rather than being arbitrarily paired.

Bounded dispatch records and profiler traces are excluded from authoritative checkpoint topology. Existing `searchDispatches` / `profilerTraces` remain available when the Agent needs occurrence/timing evidence and preserve their bounded semantics.

Expose the same two logical operations through:

- the existing DSH `CordisRuntime` Inspect Provider;
- embedded MCP as `cordis_capture_checkpoint` and `cordis_compare_current`.

Adapters must delegate to the same implementation and must not implement their own diff algorithms.

v0.5 remains read-only with respect to the target Cordis runtime. Profiler mutation/leases, automatic reload, and root-cause/fix verdicts are deferred to later milestones.

## Alternatives considered

### Let the model compare repeated v0.4 queries itself

Rejected as the product boundary. It duplicates matching rules across Agents, creates id-churn noise, and risks models treating bounded history or runtime-local ids as stronger evidence than they are.

### Store checkpoints server-side and return opaque checkpoint ids

Rejected for v0.5. It would introduce retention capacity, TTL, ownership, multi-Agent isolation, persistence/restart behavior, and disconnect cleanup. It also makes the DSH `cordisInspect` path less clearly read-only. Self-contained artifacts are sufficient for the first verification workflow.

### Match Fibers/listeners by uid/id across checkpoints

Rejected. Those identifiers are runtime-local and may change after reload. They remain useful within one captured state for navigation but are not safe semantic identity across checkpoints.

### Compare full observer/profiler snapshots byte-for-byte

Rejected. Snapshot ordering and runtime-local ids add noise, while bounded dispatch/profiler history is not authoritative current topology. v0.5 needs a purpose-built semantic projection.

### Persist full checkpoint files in the repository or user home

Rejected for the first slice. Persistence adds format/lifecycle/privacy responsibilities and is not required to prove same-session or Agent-held before/after verification.

### Add `fixed`, `rootCause`, or confidence to the comparison result

Rejected. The diagnostics package should return facts and mechanical diffs. Interpreting whether those facts prove a bug is fixed remains Agent/user reasoning.

### Add profiler enable/disable or profiling leases in the same milestone

Rejected. Profiler control changes the runtime dispatch seam and needs a separate permission, ownership, timeout, cleanup, and conflict design. v0.5 intentionally stays read-only; controlled runtime experiments become a later milestone.

## Acceptance criteria

- a versioned transport-neutral checkpoint contract exists and is exported from the package;
- checkpoint canonicalization is deterministic and metadata-only;
- runtime-local Fiber/listener identifiers do not affect semantic equality/diff;
- duplicate equal listener/Fiber descriptors preserve multiplicity;
- bounded dispatch/profiler history is not promoted into authoritative checkpoint topology;
- schema/digest validation rejects unsupported or tampered baselines explicitly;
- `captureCheckpoint` and `compareCurrent` share one implementation across DSH Cordis Inspect and MCP;
- DSH does not register a duplicate package-specific model tool family;
- MCP remains loopback-only and does not gain mutation tools;
- a real Cordis/DSH fixture proves a duplicate topology transition `2 → 1` and deliberately exercises runtime-local id churn;
- both Agent paths return equivalent semantic changes for the same real runtime transition;
- existing observer/UI/profiler behavior and privacy invariants remain green;
- no `fixed`, `rootCause`, confidence, automatic reload, or profiler mutation behavior is added in v0.5.

## Risks

- semantic descriptors that include too much unstable metadata can create noisy diffs; descriptors should use only existing factual metadata and canonical ordering;
- descriptors that include too little metadata can merge unrelated same-name runtime objects; multiset output and capture-local ids should preserve enough evidence for follow-up inspection without claiming stable identity;
- full-runtime checkpoints can become large on unusual installations; exact-name scoping must be deterministic so Agents can keep verification focused when needed;
- Effect labels are metadata but may be dynamic; canonicalization tests must distinguish intended structural changes from ordering noise;
- checkpoint input travels back through Agent protocols during `compareCurrent`; schemas/body limits must remain compatible with realistic runtime sizes and fail explicitly when exceeded;
- a digest implementation can accidentally depend on serialization order; canonicalization must precede hashing and be covered by permutation tests;
- implementation may reveal that a stable first-party DSH reload seam is needed for the final E2E. The test should prefer a real deterministic Cordis lifecycle transition rather than inventing production reload control solely for testing.
