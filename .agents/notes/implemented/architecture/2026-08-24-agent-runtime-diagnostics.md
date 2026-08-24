# Agent Note: Agent Runtime Diagnostics adapters

Status: implemented

## Problem

v0.3 exposes authoritative live Cordis listener/Fiber state, bounded dispatch observations, and opt-in waterfall traces through a human Web DevTools panel and loopback browser RPC. Coding agents often operate from source and tests without looking at that UI, while source inspection cannot prove runtime-only facts such as duplicate live listeners after reload, current Fiber ownership, stale lifecycle instances, or whether an event appeared in the retained observer window.

DSH already provides a model-facing `cordisInspect` registry and generic `cordis_inspect_list` / `cordis_inspect_query` tools. Replacing that mechanism with a package-specific DSH tool family would duplicate first-party infrastructure. External agents such as Codex, Claude Code, and Cursor still need a cross-process standard interface to the currently running DSH instance.

## Decision

v0.4 introduces one transport-neutral `RuntimeDiagnosticsQuery` over the existing observer/profiler snapshots and exposes the same five read-only logical queries through two thin Agent adapters:

1. a lifecycle-owned DSH Host Cordis Inspect Provider named `CordisRuntime` when the optional first-party `cordisInspect` service exists;
2. an embedded MCP server owned by the running plugin instance, using Streamable HTTP bound to `127.0.0.1` for external clients.

The shared query layer owns runtime summary, event inspection, authoritative live Fiber inspection, retained dispatch search, existing profiler-trace search, ordering, filtering, and bounded/truncated evidence semantics. Neither adapter reimplements snapshot traversal.

The MCP endpoint is disabled by default. When enabled it uses a configured loopback port, never widens to a remote host, contains listener startup failure to the optional MCP surface by default, and supports explicit fail-fast behavior through `mcp.failOnStartupError`. The official MCP SDK baseline is `^1.30.0`.

The first slice stays metadata-only and read-only. Profiler mutation remains deferred because enabling instrumentation changes runtime behavior and needs a separate permission/lease decision.

The final real DSH proof uses one duplicate-Fiber runtime fixture: two same-name live Fibers own two registrations of one event. The DSH Cordis Inspect path and an external official MCP Client both recover the same live-owner/Fiber evidence and bounded recent dispatch fact; the same process also keeps the human Web/Profiler smoke.

## Alternatives considered

### Let agents infer runtime state from source and existing DSH inspectors

Rejected as the sole approach. Existing capability inspectors describe APIs/contracts and source can describe intended registrations, but neither proves current listener multiplicity, live Fiber ownership, lifecycle residue, or observed runtime dispatch facts.

### Register package-specific DSH model tools directly

Rejected. DSH already has a lifecycle-owned Cordis Inspect registry with provider discovery, schema validation, Agent scoping, cancellation, and generic model-facing tools. A provider is the narrower extension point and avoids duplicate tool definitions.

### Make MCP the only adapter and connect DSH back to itself

Rejected. It would add an unnecessary HTTP/protocol hop for in-process DSH agents and make internal diagnostics depend on an external transport.

### Run a standalone stdio MCP server

Rejected as the primary architecture. A separate process has no direct ownership of the already-running Cordis runtime and would otherwise inspect the wrong runtime or require another IPC layer.

### Add an automatic `diagnose()` API

Rejected. Root-cause inference belongs to the model. The diagnostics package exposes facts and preserves unknown/bounded semantics instead of hard-coding probabilistic conclusions.

### Expose profiler start/stop in the first Agent surface

Rejected for this slice. Instrumentation is mutating, can affect dispatch behavior, and requires an explicit permission, ownership, timeout/lease, and cleanup design.

## Consequences

Human DevTools, DSH-native Agent inspection, and external MCP clients now share one runtime diagnostics contract. Current listener/Fiber inventory remains authoritative; retained dispatch/profiler evidence stays explicitly bounded and query limits stay explicitly truncated rather than being mistaken for complete history.

The plugin adds an optional local MCP listener and official MCP SDK runtime dependency only for the external-Agent path. Loopback limits network exposure but is not a confidentiality boundary against other local processes, so remote/LAN access and stronger authentication remain separate future decisions.

The read-only v0.4 slice is covered at pure-query, adapter, protocol, and real-DSH levels, including a deterministic duplicate-Fiber scenario. Controlled profiler mutation remains Wave F and requires a new decision note before implementation.
