# Agent Note: CordisRuntime Inspect Provider

Status: implemented

## Problem

DSH already exposes a first-party `cordisInspect` registry and generic model-facing `cordis_inspect_list` / `cordis_inspect_query` tools. Registering a second package-specific DSH tool family would duplicate discovery, schema validation, Agent scoping, cancellation, and lifecycle behavior.

The runtime diagnostics package still needs to make its live listener/Fiber/dispatch/profiler facts discoverable to DSH agents without requiring the Web panel.

## Decision

Register one optional Host Cordis Inspect Provider with id `CordisRuntime` whenever the Host exposes a `cordisInspect` service. The provider delegates every method to the shared `RuntimeDiagnosticsQuery` instance owned by `DevtoolsService`.

The provider exposes five read-only methods: `runtimeSummary`, `inspectEvent`, `inspectFiber`, `searchDispatches`, and `profilerTraces`. Its manifest contains machine-readable input schemas and generic JSON output ownership; the query layer remains authoritative for finer semantic validation such as exactly-one Fiber selector and bounded limit ranges.

The integration uses a narrow structural `register()` boundary instead of taking a compile-time dependency on DSH Host runner packages. `ctx.inject(['cordisInspect'], ...)` keeps the integration optional for pure Cordis usage, and the actual provider registration is wrapped in an effect so disposal follows the owning runtime lifecycle.

## Alternatives considered

- Register five new `ctx.tools` tools directly. Rejected because DSH already supplies a generic model-facing Cordis Inspect tool surface.
- Depend directly on `@deepseek-ai/dsh-cordis-host-runner` types. Rejected for the initial adapter because the plugin should remain usable in pure Cordis environments and only needs the stable structural `register()` seam.
- Route DSH Agent queries through the external MCP server. Rejected because that adds an unnecessary protocol/HTTP dependency for an in-process Host capability.
- Copy snapshot filtering into the Provider. Rejected because DSH and MCP adapters must share one query implementation.

## Consequences

A DSH Agent can discover `CordisRuntime` through existing Cordis Inspect tooling when the service is present, while pure Cordis installations continue to run without that DSH service. The provider exposes facts only; it does not perform root-cause inference or profiler mutation.
