# Agent Note: Runtime Diagnostics Query Layer

Status: implemented

## Problem

The v0.3 observer and profiler expose complete bounded snapshots for the Web client, but model-facing adapters need targeted runtime facts without repeatedly transferring and re-filtering the full observer/profiler state. DSH Cordis Inspect and external MCP must also agree on live/historical and bounded/truncated semantics rather than implementing separate traversal rules.

## Decision

Add a transport-neutral `RuntimeDiagnosticsQuery` over the existing `DevtoolsService` source. It exposes five read-only queries: runtime summary, exact event inspection, authoritative live Fiber inspection, retained dispatch search, and retained profiler trace search.

The query layer consumes project-owned observer/profiler snapshots; it does not access Cordis internals directly. `DevtoolsService` owns one query instance so future adapters share the same implementation.

Dispatch and profiler searches return newest-first results with explicit `bounded`, `retained`, `matched`, `returned`, and caller-limit `truncated` metadata. This makes an empty result mean only “not present in the retained bounded evidence,” not “never happened.”

Event inspection annotates each current listener owner with `ownerLive` by checking the authoritative live Fiber inventory. Fiber inspection returns only live inventory matches and derives owned listeners/events plus recent dispatch-context hit counts from the same observer snapshot; historical references are not promoted into live Fibers.

The first query contract is intentionally metadata-only and read-only. It does not enable profiler instrumentation, capture raw payloads, or infer a root cause.

## Alternatives considered

- Let each adapter filter `snapshot()` independently. Rejected because DSH and MCP would drift in ordering and evidence semantics.
- Add targeted methods directly to browser RPC first. Rejected because browser transport is not the reusable product boundary; the query layer must remain transport-neutral.
- Return a full snapshot to every Agent and rely on model filtering. Rejected because it wastes context and makes bounded/history semantics easier to misinterpret.
- Add a `diagnose()` method that returns likely causes. Rejected because inference belongs to the model and the project must keep unknown facts unknown.

## Consequences

DSH Cordis Inspect and MCP can be thin adapters over one canonical read-only query layer. The shared contract becomes part of the package type surface and must remain factual. Common queries avoid shipping unrelated runtime state, but their results remain snapshots taken at call time rather than transactional views across multiple calls.
