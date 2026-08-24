# Agent Note: Deterministic runtime debugging proof

Status: implemented

## Problem

Source inspection can suggest a single plugin/event registration site while a live Cordis process actually contains multiple active Fiber instances and therefore multiple current listener registrations. v0.4 needs a deterministic proof that the Agent-facing evidence contract can expose that runtime fact without upgrading bounded recent dispatch history into certainty about the past.

## Decision

Add a transport-neutral test fixture at the shared `RuntimeDiagnosticsQuery` layer with two authoritative live Fibers that share the same plugin name and own two listeners for the same event.

The proof follows the intended Agent evidence chain:

1. `inspectEvent` returns two current listeners and two distinct live owner uids.
2. `inspectFiber` by exact name returns both live Fibers, while exact uid resolves each authoritative instance separately.
3. `searchDispatches` returns newest-first recent evidence and always carries `bounded: true`; applying a limit must set `truncated: true` rather than implying historical completeness.

This proof deliberately stays transport-neutral. Cordis Inspect and MCP adapters already delegate to the same Query layer and have their own real integration coverage, so duplicating the complete semantic fixture in each adapter would create parallel contract implementations rather than stronger evidence.

## Alternatives considered

- Only document the duplicate-Fiber scenario. Rejected because the core evidence chain should be executable and regression-protected.
- Build the first proof around an LLM prompt. Rejected because model output is nondeterministic and would require credentials; the product contract is the runtime evidence exposed to the Agent, not one model's prose.
- Duplicate the same fixture independently in Cordis Inspect and MCP tests. Rejected because the adapters are intentionally thin delegators over one canonical Query layer.

## Consequences

The repository gains a stable Wave E semantic proof that distinguishes authoritative current registration/Fiber state from bounded recent dispatch evidence. Adapter-specific E2E tests can focus on proving reachability of this shared contract rather than reimplementing its semantics.
