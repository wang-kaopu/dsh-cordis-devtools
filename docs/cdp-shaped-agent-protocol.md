# CDP-shaped Agent Debug Protocol

Status: proposed architecture

## Goal

Evolve `dsh-cordis-devtools` from an MCP tool collection with a snapshot/wait workflow into an Agent-first runtime debugging protocol that uses the useful interaction model of Chrome DevTools Protocol (CDP): target discovery, explicit sessions, domain-scoped commands, asynchronous events, protocol introspection, and CDP-shaped JSON messages.

The primary Agent transport remains MCP. The first implementation does **not** require a raw WebSocket client in the Agent host and does **not** claim compatibility with Chrome DevTools Frontend. A raw CDP-style WebSocket endpoint is specified later in this document as a deferred adapter that can reuse the same protocol core.

The intended Agent workflow becomes:

```text
get protocol
    ↓
list targets
    ↓
attach
    ↓
enable relevant domains
    ↓
query current state
    ↓
wait/read protocol events
    ↓
query exact evidence
    ↓
optionally run a bounded profiler experiment
    ↓
detach
```

The important product property is not that the model speaks to a WebSocket. It is that the Agent can interrogate a live Cordis runtime through one discoverable command/event protocol instead of learning an ever-growing list of unrelated MCP tools.

## Non-goals

This proposal does not:

- emulate Chromium, V8, DOM, Page, Network, Debugger, or other browser-specific semantics;
- make Chrome DevTools Frontend work against a Cordis runtime;
- rename Cordis concepts into misleading standard CDP domains;
- capture event arguments, return values, prompts, tool results, file contents, secrets, or arbitrary runtime payloads;
- turn bounded observations into a lossless audit log;
- infer listener execution, dispatch completion, root cause, remediation success, or facts Cordis does not expose;
- remove MCP as the primary Agent-facing transport;
- remove existing focused MCP tools in the first migration step.

## Current baseline

The repository already contains most of the runtime primitives required by an event-oriented debugger:

```text
Cordis runtime
    │
    ├─ internal/dispatch
    ├─ internal/plugin
    ├─ internal/status
    └─ internal/listener
          │
          ▼
ObserverCollector / TraceStore / Coordinator
          │
          ▼
RuntimeNotificationSource
          │
          ▼
AgentDebugService
    ├─ target + targetEpoch
    ├─ debug sessions
    ├─ bounded ObservationJournal
    ├─ monotonic sequence
    ├─ gap detection
    ├─ snapshot projection
    └─ session-owned experiment leases
```

The main mismatch is above this core. Agent access is currently expressed as many MCP operations, while the browser observer still uses request/response snapshot RPC and polling. The protocol proposal therefore reuses the existing authoritative runtime collectors, notification source, target/session lifecycle, journal, diagnostics queries, and experiment coordinator instead of creating a parallel debugging state machine.

## Architecture boundary

Introduce a transport-neutral protocol layer between `AgentDebugService`/runtime diagnostics and external adapters.

```text
                         Live Cordis runtime
                                │
                                ▼
                 authoritative host observers
                                │
                                ▼
                  RuntimeNotificationSource
                                │
                                ▼
                 ┌─────────────────────────┐
                 │ DevTools Protocol Core  │
                 │                         │
                 │ target/session registry │
                 │ domain command router   │
                 │ protocol schema         │
                 │ bounded event journal   │
                 │ sequence/gap semantics  │
                 └────────────┬────────────┘
                              │
             ┌────────────────┼─────────────────┐
             ▼                ▼                 ▼
        MCP adapter      Browser adapter   future WS adapter
        Agent-first      Human UI          CDP-shaped wire
             │                │                 │
             ▼                ▼                 ▼
            Agent         React DevTools    external clients
```

The Protocol Core must not own a second collector, second trace store, second target registry, second observation history, or second experiment coordinator. Existing Host-owned state remains authoritative.

A practical implementation may evolve `AgentDebugService` into the Protocol Core rather than introducing a new service class. The class boundary is less important than preserving a single owner for target/session/journal/lease state.

## Protocol model

### Targets and sessions

Keep the existing exact target identity model:

- `targetId` is opaque and identifies one active Cordis runtime target;
- `targetEpoch` distinguishes target incarnations and prevents silent rebinding after reload/replacement;
- `sessionId` is opaque and bound to the exact target id/epoch;
- detach, expiry, replacement, or Host disposal invalidates the session and releases owned resources.

Protocol messages use the CDP flattened-session shape: when a command/event is session-scoped, `sessionId` appears at the top level of the frame.

### Domains

The first protocol version should be deliberately small:

```text
Schema.*
Target.*
Cordis.*
Fiber.*
Profiler.*
```

Potential future domains are `Effect.*`, `Scope.*`, `Service.*`, and `Agent.*`. They should be added only when their runtime facts and semantics are authoritative enough to support a stable contract.

Do not map Cordis concepts onto unrelated standard CDP domains merely to look compatible. `Fiber` is a Cordis debugging concept, not a `Runtime.ExecutionContext`; a Cordis dispatch is not `Runtime.consoleAPICalled`.

### Initial command surface

The exact names may be refined during implementation, but the first schema should cover these capabilities:

```text
Schema.getDomains

Target.getTargets
Target.attachToTarget
Target.detachFromTarget

Cordis.enable
Cordis.disable
Cordis.getSnapshot
Cordis.getEvent
Cordis.getListeners
Cordis.searchDispatches
Cordis.captureCheckpoint
Cordis.compareCurrent

Fiber.getFibers
Fiber.getFiber

Profiler.getStatus
Profiler.getTraces
Profiler.startExperiment
Profiler.stopExperiment
```

`Cordis.enable`/`disable` controls delivery of low-cost Cordis protocol events for that session; it does not alter Cordis dispatch semantics. Domain enablement is session-local subscription state.

`Profiler.startExperiment` and `Profiler.stopExperiment` remain explicit bounded mutations routed through the existing `WaterfallExperimentCoordinator`. They retain the current authentication/capability/lease rules. `Profiler.enable` must not be overloaded to silently start instrumentation.

### Initial event surface

Version 1 should expose only events backed by facts already produced by the Host:

```text
Cordis.dispatchObserved
Cordis.topologyInvalidated
Profiler.traceUpdated
Profiler.statusChanged
Target.targetDestroyed
```

These map directly from the current metadata-only runtime notification/journal model. `dispatchObserved` remains a pre-execution dispatch observation, not completion or listener-execution evidence. `topologyInvalidated` tells the client to query authoritative current state; it is not a synthetic listener/Fiber diff.

More granular events such as `Fiber.created`, `Fiber.disposed`, `Cordis.listenerAdded`, or `Cordis.listenerRemoved` are deferred until the Host can emit them from authoritative lifecycle facts without inferring an unsupported transition.

## CDP JSON message shape

The Protocol Core uses CDP-style command, response, error, and event frames even when the transport is MCP.

### Command

```json
{
  "id": 17,
  "method": "Fiber.getFiber",
  "params": {
    "uid": 31
  },
  "sessionId": "session-opaque-id"
}
```

`id` is a caller-selected positive integer used to correlate responses. MCP requests do not technically require an inner correlation id, but retaining it keeps one protocol frame format across MCP, Browser, tests, CLI, and a future WebSocket adapter.

### Success response

```json
{
  "id": 17,
  "result": {
    "fiber": {
      "uid": 31,
      "name": "agent-loop",
      "state": "active"
    }
  },
  "sessionId": "session-opaque-id"
}
```

### Error response

```json
{
  "id": 17,
  "error": {
    "code": -32602,
    "message": "invalid params",
    "data": {
      "code": "invalid-fiber-uid"
    }
  },
  "sessionId": "session-opaque-id"
}
```

Use stable machine-readable error data for Agent recovery. Suggested generic codes are `-32601` for unknown method, `-32602` for invalid params, and `-32000` for a protocol/server failure; domain-specific recovery information belongs in `error.data.code` rather than prose parsing.

### Event

```json
{
  "method": "Cordis.dispatchObserved",
  "params": {
    "sequence": 1042,
    "observedAt": 1787899200000,
    "dispatchId": 381,
    "event": "agent/pre-step",
    "mode": "serial",
    "argCount": 1,
    "registeredListeners": 2
  },
  "sessionId": "session-opaque-id"
}
```

`sequence` is a Cordis DevTools extension carried inside event params. It is target-local and monotonic. It is not presented as a standard CDP field.

## Snapshot + event consistency

The protocol must preserve the current bounded-journal guarantees and avoid creating a race where an Agent takes a snapshot and misses a change that happened while the snapshot was being produced.

The recommended sequence is:

1. attach a session;
2. enable the relevant event domains;
3. record the journal's current sequence as the snapshot barrier;
4. build the authoritative snapshot;
5. return the snapshot plus the barrier as `eventCursor`;
6. consume events with `sequence > eventCursor`.

Capturing the barrier **before** the snapshot means events that happen while the snapshot is being built may be represented both in the snapshot and in later events, but they are not silently lost. Duplicate invalidation is acceptable; missing a transition is not.

Example result:

```json
{
  "id": 4,
  "result": {
    "eventCursor": {
      "targetEpoch": 7,
      "sequence": 812
    },
    "snapshot": {}
  },
  "sessionId": "session-opaque-id"
}
```

If a requested cursor falls behind the bounded journal, the protocol returns an explicit gap result/error carrying the current retained window. Recovery is a fresh snapshot followed by resuming from the new cursor. Bounded absence never means an event never happened.

## Agent-facing MCP adapter

MCP remains the primary transport, but the preferred Agent API becomes a small set of protocol primitives rather than one MCP tool per debugger operation.

Recommended tools:

```text
cordis_devtools_get_protocol
cordis_devtools_list_targets
cordis_devtools_attach
cordis_devtools_send
cordis_devtools_read_events
cordis_devtools_wait_for_event
cordis_devtools_detach
```

### `cordis_devtools_get_protocol`

Returns protocol name/version, domains, commands, events, parameter/result schemas, descriptions, and experimental/deprecated markers. This is the Agent equivalent of CDP protocol introspection and is a core feature, not optional documentation.

An Agent that does not know how to inspect an Effect or Fiber should be able to discover the relevant domain and command instead of relying on a hard-coded Skill that enumerates every future operation.

### `cordis_devtools_send`

Accepts one CDP-shaped command frame and returns one CDP-shaped response frame. New protocol commands therefore do not require adding new MCP tool names.

### `cordis_devtools_read_events`

Returns a bounded ordered batch after an explicit `sequence`, optionally filtered by exact method/domain. The result includes retained-window and gap metadata.

### `cordis_devtools_wait_for_event`

Performs one bounded long-poll for the first matching event after an explicit sequence. It preserves the existing Agent-friendly `waitForRuntimeChange` behavior while presenting events through the protocol envelope.

The default/max wait limits should remain bounded. Detach, target replacement, session expiry, and Host disposal cancel pending waits.

### Backward compatibility

Existing focused MCP tools remain during migration. They become convenience/compatibility adapters over the same Host/Core operations, not independent implementations. The packaged Skill should gradually prefer the protocol primitives, while older Agents can continue to call tools such as `cordis_inspect_event` or `cordis_profiler_traces`.

Removal of old tools is a separate compatibility decision and is not part of this proposal.

## Browser migration

The Browser UI should eventually consume the same Protocol Core so the product tests its own public debugging model.

Current shape:

```text
Browser store
    ↓ every ~1s
snapshot RPC
    ↓
Host snapshot
```

Target shape:

```text
Browser ProtocolClient
    ├─ command frames → Protocol Core
    └─ event frames   ← Protocol Core
             │
             ▼
     incremental client store
             │
             ▼
 Events / Fibers / Timeline / Profiler
```

The Browser transport does not need to become raw WebSocket immediately. DSH Connection may provide an in-process notification path; otherwise the browser adapter can initially use the same bounded read/wait semantics. The important invariant is that Browser and Agent consume the same domain contracts and event semantics.

## Protocol schema and versioning

Keep protocol version separate from package/product version.

Example:

```json
{
  "protocolVersion": "1.0",
  "product": "dsh-cordis-devtools/0.9.0",
  "domains": []
}
```

Rules:

- adding optional fields/commands/events is backward-compatible within a major protocol version;
- removing/renaming a command, changing required params, or changing field semantics requires an explicit protocol compatibility decision;
- experimental domains/commands are marked in introspection;
- the Core validates params at the command boundary;
- transport adapters do not maintain independent protocol schemas.

The protocol schema should be the source from which TypeScript types and, where practical, validators/client helpers are generated or checked. Avoid maintaining unrelated handwritten copies of the same command/event contract.

## Privacy and evidence rules

The protocol inherits all current observability constraints:

- metadata-only by default;
- no arbitrary argument/return/error payload capture;
- bounded dispatch, trace, event, session, cursor, and waiter storage;
- explicit truncation/gap/window facts;
- no inferred completion or listener-execution result;
- no automated root-cause/fixed/remediation claim;
- exact target/session/lease ownership;
- direct Cordis internals remain isolated behind the existing adapter seam.

Protocol introspection must describe these limitations where they affect interpretation. An Agent should be able to learn from the schema/description that `Cordis.dispatchObserved` is pre-execution evidence and not mistake it for successful handling.

## Implementation plan

### Phase 0 — schema and protocol core

- Add transport-neutral frame types for command/response/event/error.
- Add a protocol schema for `Schema`, `Target`, `Cordis`, `Fiber`, and `Profiler`.
- Add one command router that delegates to existing `AgentDebugService`, `RuntimeDiagnosticsQuery`, and `WaterfallExperimentCoordinator` boundaries.
- Map the existing notification/journal facts to protocol event envelopes.
- Preserve one target/session/journal/lease owner.
- Add protocol contract and router tests without changing current MCP/Browser behavior.

### Phase 1 — Agent-first MCP primitives

- Add the seven protocol MCP tools.
- Route `send`, event read/wait, attach, and detach through the Protocol Core.
- Update the packaged Skill to use protocol discovery and generic `send`/event operations.
- Keep existing tools as compatibility helpers.
- Add real Agent debugging proof tests for discover → attach → snapshot/query → wait event → query exact evidence → detach.

### Phase 2 — Browser consumes the protocol

- Replace `SnapshotPort`/periodic polling with a ProtocolClient-backed store.
- Use an initial snapshot plus event cursor, then incremental invalidation/event consumption.
- Keep explicit refresh/recovery for gap/stale-session cases.
- Preserve current Human profiler emergency-stop semantics.

### Phase 3 — richer domains only from authoritative evidence

- Add granular listener/Fiber/Effect/Scope/Service events only where Cordis exposes a factual lifecycle signal.
- Expand schema and Agent workflows without expanding the MCP tool namespace.

### Deferred — raw CDP-style WebSocket adapter

Implement only when a concrete external client benefits from it. The design is below so the Protocol Core does not accidentally make later wire compatibility impossible.

## Deferred CDP-style WebSocket endpoint

### Purpose

Expose the same Protocol Core over a CDP-shaped WebSocket transport for external debuggers, IDE integrations, CLI clients, or protocol test tools. This adapter is **not** required for MCP Agents and does not imply Chrome DevTools Frontend compatibility.

### Discovery endpoints

Potential loopback endpoints:

```text
GET /json/version
GET /json/list
GET /json/protocol
```

Example `/json/version`:

```json
{
  "Browser": "dsh-cordis-devtools/0.9.0",
  "Protocol-Version": "1.0"
}
```

Example `/json/list` target:

```json
[
  {
    "id": "opaque-target-id",
    "type": "other",
    "title": "Cordis Runtime",
    "description": "Live Cordis runtime debugging target",
    "webSocketDebuggerUrl": "ws://127.0.0.1:43128/devtools/page/opaque-target-id"
  }
]
```

`/json/protocol` returns the same schema used by MCP `cordis_devtools_get_protocol`; there must not be a separate WebSocket-only schema.

### WebSocket path

Recommended first endpoint:

```text
WS /devtools/page/{targetId}
```

A connection creates or attaches an exact protocol session for that target. Incoming text frames are CDP-shaped command objects; outgoing frames are response/error/event objects.

A future multi-target/browser endpoint may add:

```text
WS /devtools/browser/{browserId}
```

with `Target.attachToTarget` flattened sessions. Do not introduce the browser endpoint until there is a real need for one socket multiplexing multiple targets.

### Authentication

Do not copy Chrome's unauthenticated local-debugging assumptions by default. Reuse the existing loopback and bearer-token policy where technically possible, including authentication on the HTTP discovery endpoints and WebSocket upgrade.

Some Chrome-native discovery flows cannot conveniently attach custom authorization headers. Supporting `chrome://inspect` may therefore require a separate explicit local-insecure mode or another bootstrap mechanism. That is a future security/product decision, not a reason to weaken the default endpoint.

### Event replay and reconnect

Raw CDP itself does not define replay, but the Cordis domains can retain the protocol extension:

```text
Cordis.getSnapshot → eventCursor
Cordis.readEvents({ afterSequence })
```

After reconnect, a client either resumes from a retained sequence or receives an explicit gap and takes a fresh snapshot. A new target epoch always invalidates the old session/cursor.

### Backpressure

The WebSocket adapter must not grow an unbounded outbound queue. Use an explicit per-connection queue limit. If a client cannot keep up, close the connection with a documented code/reason and require snapshot/gap recovery after reconnect rather than silently dropping arbitrary frames while pretending the stream is complete.

### WebSocket-specific tests

Before shipping the adapter, add tests for:

- `/json/version`, `/json/list`, and `/json/protocol` using the shared schema;
- authenticated loopback upgrade behavior;
- command id correlation;
- flattened/top-level `sessionId` handling;
- ordered event delivery;
- reconnect + retained sequence recovery;
- gap recovery;
- target replacement/stale session behavior;
- bounded outbound queue/backpressure;
- cleanup on socket close and Host disposal;
- at least one real external CDP-style client exercising the endpoint.

## Acceptance criteria for the main proposal

The CDP-shaped Agent protocol is ready when:

1. an Agent can discover the protocol without a pre-enumerated list of all commands;
2. the normal debugging workflow uses target → session → command/event semantics;
3. generic `send` can invoke every protocol command without adding a new MCP tool;
4. event read/wait uses monotonic sequence, bounded retention, explicit gap recovery, and session lifecycle cancellation;
5. snapshot + event cursor semantics cannot silently miss a change during snapshot construction;
6. the first event set contains only authoritative current Host facts;
7. profiler mutation still uses the existing coordinator, authentication/capability rules, finite leases, and exact-owner cleanup;
8. existing focused MCP tools remain compatible during migration;
9. Browser migration can consume the same protocol contracts without another Host debugging model;
10. no code claims Chrome DevTools Frontend or Chromium domain compatibility.

## Strongest alternative considered

The strongest alternative is to keep the existing MCP tool surface and only replace browser polling with SSE/WebSocket notifications. That is smaller in the short term, but it leaves Agent capabilities fragmented across tool names and makes every new debugger operation expand the MCP namespace. It also prevents protocol introspection from becoming the stable interface an Agent can explore dynamically.

The chosen approach keeps MCP transport while standardizing the **debugging model**, which is the part of CDP that materially helps an Agent.

## Intentionally deferred

- Chrome DevTools Frontend support;
- browser-specific CDP domains;
- raw WebSocket shipping date;
- `chrome://inspect` compatibility;
- remote/LAN debugging;
- multi-process target aggregation;
- pause/resume/breakpoints/expression evaluation;
- payload capture;
- granular lifecycle events unsupported by authoritative Cordis signals;
- removal of legacy focused MCP tools.
