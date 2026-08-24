# Agent Runtime Diagnostics

This guide describes the completed first v0.4 read-only Agent-facing slice. Human DevTools, DSH Cordis Inspect, and embedded MCP now share one Runtime Diagnostics Query contract; controlled profiler mutation remains explicitly deferred.

## What Agent access adds

Agent access exposes **live runtime evidence** that source reading and API catalogs cannot prove:

- current listener multiplicity and order;
- current listener → owner Fiber relationships;
- authoritative live Fiber state, inject metadata, Effects, and owned registrations;
- recent dispatch occurrences inside the retained bounded observer window;
- already-recorded waterfall profiler traces.

It does not replace source analysis. An Agent should combine runtime evidence with source, tests, and logs when reasoning about a bug.

## Shared query vocabulary

Both DSH-native and MCP adapters represent the same five logical reads:

| Logical query | Purpose |
| --- | --- |
| `runtimeSummary` | Discover compact counts and current bounded evidence windows. |
| `inspectEvent` | Inspect current registrations for one exact event. |
| `inspectFiber` | Inspect authoritative live Fiber state by uid or exact name. |
| `searchDispatches` | Search retained observer dispatch occurrences newest-first. |
| `profilerTraces` | Read already-recorded waterfall traces without enabling instrumentation. |

The adapters may use different protocol-facing names, but the returned facts have the same semantics.

## DSH Agent path

DSH already owns the model-facing Cordis Inspect tools. `dsh-cordis-devtools` therefore contributes a Provider rather than registering another model tool family.

When a DSH composition includes the first-party Cordis Inspect infrastructure, the Provider is discoverable as:

```text
platform: host
provider: CordisRuntime
```

A model normally follows the existing DSH flow:

```text
cordis_inspect_list
  ↓
find CordisRuntime
  ↓
cordis_inspect_query
```

Example conceptual query:

```json
{
  "platform": "host",
  "provider": "CordisRuntime",
  "method": "inspectEvent",
  "input": {
    "name": "session/created"
  }
}
```

`CordisRuntime` is optional. Pure Cordis deployments without DSH `cordisInspect` continue to use the human DevTools/ordinary service API without an Agent Provider.

### DSH composition note

The first-party `cordisInspect` registry is provided by DSH Cordis Host Runner and its generic model tools are provided by DSH Tool Cordis. A composition that wants model-native inspection therefore needs the corresponding DSH Cordis tooling enabled; `dsh-cordis-devtools` does not duplicate those packages.

The v0.4 integration suite exercises the Provider against the real DSH Host registry and the duplicate-Fiber fixture: it discovers `CordisRuntime`, confirms two current listener owners, resolves both authoritative live Fibers, and preserves bounded dispatch semantics.

## External Agent path — MCP

External coding agents connect to an MCP server embedded in the **same running DSH Host process** that owns the Cordis runtime.

The server is disabled by default. The intended configuration shape is:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

The server binds only to:

```text
http://127.0.0.1:43127/mcp
```

There is intentionally no first-slice configuration for `0.0.0.0` or another remote host.

The Host prints the effective endpoint when the server starts. A bind/startup failure is explicit and the server never silently widens its network interface or chooses a different configured port.

By default, MCP is an optional adapter: a startup failure is logged and MCP remains unavailable, but the observer and human DevTools stay active. Set `failOnStartupError: true` when MCP availability is a deployment requirement and the plugin should reject activation if the listener cannot start.

### MCP tools

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
```

All first-slice tools are marked read-only and idempotent.

A typical external-Agent flow is:

```text
User: “Why is session/created running twice?”

Agent
  → cordis_inspect_event({ name: "session/created" })
  → sees two current listeners with two owner uids
  → cordis_inspect_fiber({ uid: ... }) for each owner
  → confirms both owner Fibers are currently live
  → reads source/lifecycle code with runtime evidence in hand
```

The important difference is that the Agent no longer has to infer listener multiplicity from source-level `ctx.on(...)` calls.

The protocol suite uses the official MCP SDK Client. Its final real DSH smoke first proves the DSH Cordis Inspect path against the duplicate-Fiber fixture, then connects an external MCP Client to the same Host and recovers the same evidence, and finally continues the existing human Web UI/profiler assertions. All three consumers therefore observe one running runtime.

## Evidence semantics an Agent must preserve

### Empty dispatch search is not proof of “never happened”

Dispatch history is a ring buffer. Results contain bounded-window metadata. Therefore:

```json
{
  "records": [],
  "window": {
    "bounded": true,
    "retained": 100,
    "matched": 0,
    "returned": 0,
    "truncated": false
  }
}
```

means:

> no matching record was observed in the currently retained bounded window.

It does **not** mean:

> the event has never happened.

### Query truncation is separate from retention loss

`truncated: true` means the caller's result limit omitted additional matches that are currently retained. `bounded: true` means older runtime history may already have been overwritten before the query.

Those are different forms of incompleteness and must not be collapsed.

### Live Fibers are authoritative

`inspectFiber` returns only the authoritative current Fiber inventory. Historical dispatch/listener references may remain readable elsewhere, but they are not upgraded into live Fiber results.

Event inspection can therefore report a historical owner reference as not currently live without inventing a current Fiber for it.

### Profiler reads do not enable profiling

`profilerTraces` reports the current instrumentation state and existing retained traces only. Merely giving an Agent access to diagnostics does not patch Cordis waterfall dispatch.

## Runtime-only duplicate registration proof

The deterministic v0.4 Agent proof models a source-level shape that appears singular while the live process contains two same-name Fibers that both own a listener for the same event.

The expected evidence chain is:

```text
inspectEvent
  → two current listeners
  → owner uid A + owner uid B
  → one shared runtime owner name
inspectFiber(name)
  → two authoritative live Fibers
inspectFiber(uid A / uid B)
  → each Fiber owns the event
searchDispatches
  → bounded recent occurrence evidence
  → an observed record reports registeredListeners = 2
```

Listener ownership comes from the current listener/Fiber registry. Dispatch context is not treated as listener ownership; dispatch history only contributes bounded recent evidence that the event was observed while two listeners were registered.

If a query limit omits a currently retained match, `truncated: true` is returned separately from the bounded-retention signal. This is the key distinction that prevents an Agent from turning recent runtime evidence into a claim about complete history.

## Privacy boundary

The Agent adapters preserve the existing metadata-first contract. They do not add:

- raw event arguments;
- listener return values;
- error objects/messages;
- prompts or model outputs;
- tool results;
- file contents;
- plugin config;
- credentials;
- raw Effect functions/disposers.

MCP still exposes runtime topology to other local processes, so loopback-only does not make the endpoint a confidentiality boundary against untrusted software running under the same machine/user account. Authentication and broader remote access require a separate design decision.

## Why DSH does not connect to its own MCP endpoint

Both paths exist for different boundaries:

```text
DSH Agent
  → cordisInspect
  → Runtime Diagnostics Query

External Agent
  → MCP
  → Runtime Diagnostics Query
```

Routing the in-process DSH Agent through loopback MCP would add a protocol/network dependency without gaining any runtime facts. The shared Query layer, not MCP, is the product's source of machine-facing semantics.

## Deferred mutation path

Profiler control is deliberately not part of the first Agent surface.

Future tools may provide a bounded profiling lease or explicit start/stop controls, but they require a separate decision covering:

- user/tool execution permission;
- cleanup when an Agent disappears;
- timeout/lease behavior;
- Cordis instrumentation conflict handling;
- explicit communication that instrumentation is not behavior-neutral observation.
