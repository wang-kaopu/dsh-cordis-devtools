# Agent Note: Agent Runtime Diagnostics adapters

Status: proposed

## Problem

v0.3 exposes authoritative live Cordis listener/Fiber state, bounded dispatch observations, and opt-in waterfall traces through a human Web DevTools panel and loopback browser RPC. This is useful when a developer opens the panel, but coding agents often operate from source and tests without looking at that UI.

Source inspection can establish intended registrations and available APIs, but it cannot prove runtime-only facts such as duplicate live listeners after reload, current Fiber ownership, stale lifecycle instances, or whether an event appeared in the retained observer window.

DSH already provides a model-facing `cordisInspect` registry and the generic `cordis_inspect_list` / `cordis_inspect_query` tools. Replacing that mechanism with a package-specific DSH tool family would duplicate first-party infrastructure. External agents such as Codex, Claude Code, and Cursor still need a cross-process standard interface to the currently running DSH instance.

## Proposal

Introduce a transport-neutral Runtime Diagnostics Query layer over existing `DevtoolsService` snapshots and expose it through two adapters:

1. a DSH Host Cordis Inspect Provider named `CordisRuntime` when the first-party `cordisInspect` service exists;
2. an embedded MCP server owned by the running DSH plugin instance, using loopback-only Streamable HTTP for external agents.

The first slice is read-only and exposes logical queries for runtime summary, one event, live Fibers, retained dispatch search, and existing profiler traces. Both adapters must share the same query implementation and evidence semantics.

Results distinguish bounded retained evidence from complete history and live authoritative Fiber inventory from historical references. Empty retained-history results never claim that an event never occurred.

The MCP server observes the current Host process directly. A standalone server that creates a separate Cordis runtime is rejected because it would inspect the wrong runtime. Non-loopback binding is out of scope.

Profiler enable/disable is not exposed in the first slice because instrumentation changes dispatch behavior and needs an explicit mutation/permission design.

## Alternatives considered

### Let agents infer runtime state from source and existing DSH inspectors

Rejected as the sole approach. Existing capability inspectors describe APIs/contracts and source can describe intended registrations, but neither proves current listener multiplicity, live Fiber ownership, lifecycle residue, or observed runtime dispatch facts.

### Register package-specific DSH model tools directly

Rejected for the initial DSH integration. DSH already has a lifecycle-owned Cordis Inspect registry with provider discovery, schema validation, Agent scoping, cancellation, and generic model-facing tools. A provider is the narrower extension point and avoids duplicate tool definitions.

### Make MCP the only adapter and connect DSH back to itself through `dsh-mcp-client`

Rejected. It introduces an unnecessary HTTP/protocol hop for in-process DSH agents and makes internal diagnostics depend on an external transport that DSH does not need.

### Run a standalone stdio MCP server

Rejected as the primary architecture. A spawned standalone process has no direct ownership of the already-running Cordis runtime and would require another IPC layer before it could answer authoritative runtime questions.

### Add an automatic `diagnose()` API

Rejected. Root-cause inference belongs to the model. The diagnostics package should expose facts and preserve unknown/bounded semantics rather than hard-code probabilistic conclusions.

## Acceptance criteria

- one transport-neutral query layer serves human/DSH/MCP-facing needs without duplicating runtime traversal logic;
- DSH `cordis_inspect_list` can discover the `CordisRuntime` Provider and `cordis_inspect_query` can execute its read-only methods;
- an external MCP client can connect to the same running DSH Host and execute equivalent read-only queries;
- both adapters return consistent live/historical and bounded/truncated evidence semantics;
- MCP binds only to loopback and is lifecycle-owned by the plugin;
- observer mode remains behavior-neutral;
- no new raw payload/sensitive-data capture is introduced;
- profiler mutation remains absent until separately approved.

## Risks

- MCP dependency/version choices can add package and lockfile maintenance cost; prefer the official MCP SDK and a narrow server surface.
- a loopback MCP endpoint exposes runtime metadata to other local processes. The first slice therefore remains read-only and loopback-only; authentication may still be warranted depending on the final server transport implementation.
- Query contracts can accidentally imply stronger history guarantees than the underlying bounded stores. Tests must assert negative/empty-result wording and metadata.
- DSH `cordisInspect` is first-party infrastructure outside this repository; the adapter should use a narrow structural boundary and fail softly when that optional service is absent.
