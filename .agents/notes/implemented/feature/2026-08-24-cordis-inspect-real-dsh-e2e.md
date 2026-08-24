# Agent Note: Real DSH CordisRuntime Inspect E2E

Status: implemented

## Problem

The `CordisRuntime` adapter can be unit-tested through its narrow structural registry seam, but that alone does not prove compatibility with the first-party DSH `CordisInspectRegistryService`, its provider manifest validation, or the real Web profile composition lifecycle. The v0.4 Agent proof also needs a runtime-only fault shape that source inspection cannot establish: two same-name live Fibers simultaneously owning listeners for one event.

## Decision

Extend the real DSH Web smoke with two E2E-only local fixtures while reusing the Web profile's existing first-party Cordis Host Runner:

1. `agent-debugging-probe` creates two distinct live Cordis Fibers with the same name. Each Fiber owns one listener for `cordis-devtools-e2e/duplicate-listener` and periodically emits that event so bounded dispatch evidence exists.
2. `cordis-inspect-probe` waits for the real Host registry to discover `CordisRuntime` and executes the Wave E evidence chain through `ctx.cordisInspect.query()`:
   - `inspectEvent` must report exactly two current listeners with two distinct live owner uids;
   - `inspectFiber(name)` must return both authoritative live Fibers;
   - `inspectFiber(uid)` must resolve each owner separately and show ownership of the duplicate event;
   - `searchDispatches` must return bounded recent evidence involving one of those live Fiber uids.

Only after that chain succeeds does the probe emit a deterministic Host log marker. The smoke waits for the marker before continuing the existing browser assertions.

Both fixtures remain under `e2e/fixtures` and are not part of the package `files` list, so they do not change the production package graph.

## Alternatives considered

- Rely only on the structural unit mock. Rejected because it cannot validate DSH's real manifest/schema registry behavior.
- Reinsert another Cordis Host Runner in the fixture. Rejected because the Web profile already owns that Loader entry; the E2E must exercise the actual composition rather than create a duplicate service.
- Invoke an actual LLM through `cordis_inspect_query`. Rejected because that would require credentials and make the E2E nondeterministic; querying the same registry/service path directly proves the integration boundary and runtime evidence contract without a model call.
- Validate only one live listener. Rejected because Wave E specifically exists to prove that runtime diagnostics can reveal multiplicity hidden by an apparently singular source-level registration shape.

## Consequences

The Web E2E now proves both transport reachability and the intended runtime-debugging evidence chain through the actual DSH Cordis Inspect runtime while preserving the existing UI/profiler smoke coverage. The evidence remains factual: current listener/Fiber state is authoritative, while dispatch observations remain explicitly bounded recent history.
