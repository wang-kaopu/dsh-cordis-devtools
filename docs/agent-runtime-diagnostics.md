# Agent Runtime Diagnostics and Verification

This guide describes the completed read-only Agent-facing surface through repository version `0.5.0`. Human DevTools, DSH Cordis Inspect, and embedded MCP share one Runtime Diagnostics Query contract; v0.5 adds caller-owned checkpoints and semantic before/after comparison. Controlled profiler mutation remains explicitly deferred.

## What Agent access adds

Agent access exposes **live runtime evidence** that source reading and API catalogs cannot prove:

- current listener multiplicity and order;
- current listener → owner Fiber relationships;
- authoritative live Fiber state, inject metadata, Effects, and owned registrations;
- recent dispatch occurrences inside the retained bounded observer window;
- already-recorded waterfall profiler traces;
- canonical current-topology checkpoints;
- semantic before/after Event / Listener / Fiber multiplicity changes.

It does not replace source analysis. An Agent should combine runtime evidence with source, tests, and logs when reasoning about a bug.

## Shared query vocabulary

Both DSH-native and MCP adapters represent the same seven logical read operations:

| Logical query | Purpose |
| --- | --- |
| `runtimeSummary` | Discover compact counts and current bounded evidence windows. |
| `inspectEvent` | Inspect current registrations for one exact event. |
| `inspectFiber` | Inspect authoritative live Fiber state by uid or exact name. |
| `searchDispatches` | Search retained observer dispatch occurrences newest-first. |
| `profilerTraces` | Read already-recorded waterfall traces without enabling instrumentation. |
| `captureCheckpoint` | Return a caller-owned versioned checkpoint of authoritative current topology. |
| `compareCurrent` | Validate a supplied baseline, recapture the same scope, and return a semantic diff plus current checkpoint. |

The adapters use different protocol-facing names where appropriate, but the returned facts and verification semantics are shared.

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

The v0.5 real-DSH suite exercises this actual Host registry, captures a verification baseline through `CordisRuntime`, carries it across a real duplicate-Fiber lifecycle transition, and compares the fresh current runtime through the same Provider.

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

There is intentionally no v0.5 configuration for `0.0.0.0` or another remote host.

The Host prints the effective endpoint when the server starts. A bind/startup failure is explicit and the server never silently widens its network interface or chooses a different configured port.

By default, MCP is an optional adapter: a startup failure is logged and MCP remains unavailable, but the observer and human DevTools stay active. Set `failOnStartupError: true` when MCP availability is a deployment requirement and the plugin should reject activation if the listener cannot start.

### MCP tools

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
cordis_capture_checkpoint
cordis_compare_current
```

All seven tools are marked read-only and idempotent.

A typical external-Agent diagnostic flow is:

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

## Runtime Verification workflow

An Agent that intends to change code can preserve a focused baseline before editing:

```text
cordis_capture_checkpoint({
  scope: {
    eventNames: ["session/created"],
    fiberNames: ["SessionPlugin"]
  }
})
        ↓
caller keeps returned checkpoint
        ↓
Agent edits source / user or normal dev workflow reloads it
        ↓
cordis_compare_current({ baseline })
```

DSH uses the same logical operations as `CordisRuntime.captureCheckpoint` / `compareCurrent`.

### Checkpoints are caller-owned

A checkpoint is a self-contained JSON value, not a server-side checkpoint id. The Host does not keep checkpoint history, TTLs, or per-Agent ownership state. The caller must preserve the returned baseline and provide it back to `compareCurrent`.

The checkpoint records a schema version, canonical digest, scope, current Event/Listener topology, current live Fibers, and metadata-only Effects. It deliberately excludes bounded dispatch history and profiler traces because those are occurrence/timing windows rather than authoritative current topology.

### Scope is exact-name and deterministic

The optional checkpoint scope accepts exact `eventNames` and `fiberNames`. Event selection includes the owner Fibers required to preserve current relationships; Fiber-name selection includes their current owned listener/event relationships. Both selectors use union semantics and deterministic one-hop closure.

### Cross-checkpoint identity is semantic, not runtime-local

Capture-local fields remain useful evidence, but they are not assumed stable after reload:

- listener id: not semantic identity;
- listener registration order: retained in each checkpoint, but not semantic identity;
- owner/Fiber uid: not semantic identity;
- timestamp/digest: capture/integrity metadata, not runtime object identity.

Listener groups compare stable metadata:

```text
event
owner Fiber name / no owner
prepend
global
```

Fiber groups compare canonical metadata including name/state/parent name, sorted inject/owned events, and metadata-only Effect structure.

Equivalent duplicates are counted as a multiset. Therefore a real duplicate registration can be represented as:

```text
event listener count: 2 → 1
listener semantic group: 2 → 1
Fiber semantic group: 2 → 1
```

instead of inventing cross-reload instance pairing.

### Comparison reports facts, not a verdict

`compareCurrent` validates the baseline schema/digest, captures fresh current topology using the baseline scope, and returns current checkpoint + structured changes. It intentionally does not produce `fixed`, `rootCause`, or confidence.

An unchanged result means only that authoritative topology for that checkpoint scope is semantically equal under the v0.5 descriptor rules. It is not a general proof that an application bug is fixed.

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

`profilerTraces` reports the current instrumentation state and existing retained traces only. `captureCheckpoint` and `compareCurrent` also stay on the observer/read-only path. Merely giving an Agent access to diagnostics or verification does not patch Cordis waterfall dispatch.

## Real duplicate registration and verification proof

The deterministic Agent proof models a source-level shape that appears singular while the live process contains two same-name Fibers that both own a listener for the same event.

The diagnostic evidence chain is:

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

v0.5 adds a second real Cordis fixture for before/after verification. In one running DSH process:

```text
DSH CordisRuntime captureCheckpoint ─┐
                                     ├─ two live duplicate Fibers/listeners
external MCP captureCheckpoint ──────┘
                    ↓
        real Cordis disposal transition
                    ↓
DSH CordisRuntime compareCurrent ────┐
                                     ├─ same semantic 2 → 1 facts
external MCP compareCurrent ─────────┘
                    ↓
Human UI / waterfall profiler smoke still green
```

The two checkpoints are independent captures, so the E2E compares semantic facts rather than requiring timestamps, digests, or runtime-local ids to match. The suite uses the official MCP SDK Client and no model credential/API key.

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
  → Runtime Diagnostics Query / Verification

External Agent
  → MCP
  → Runtime Diagnostics Query / Verification
```

Routing the in-process DSH Agent through loopback MCP would add a protocol/network dependency without gaining any runtime facts. The shared Query/Verification layer, not MCP, is the product's source of machine-facing semantics.

## Deferred mutation path

Profiler control is deliberately not part of the v0.5 Agent surface.

A future controlled-runtime-experiment milestone may provide a bounded profiling lease or explicit start/stop controls, but it requires a separate decision covering:

- user/tool execution permission;
- cleanup when an Agent disappears;
- timeout/lease behavior;
- Cordis instrumentation conflict handling;
- explicit communication that instrumentation is not behavior-neutral observation.
