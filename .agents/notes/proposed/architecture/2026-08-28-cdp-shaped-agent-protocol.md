# Agent Note: Adopt a CDP-shaped Agent debugging protocol

Status: proposed

## Problem

The current Agent Debug surface already has target/session identity, bounded snapshots, monotonic runtime observations, gap recovery, exact diagnostics, and finite profiler experiment ownership, but these capabilities are exposed as a growing collection of MCP-specific operations. Each new debugging capability risks adding another top-level tool and another workflow rule that the Agent must learn in advance.

The browser side has the opposite problem: it still consumes request/response snapshots and periodic polling instead of the Host's existing realtime notification model. Adding only a browser push transport would improve freshness but would not create a common debugging contract shared by Agents, the human UI, CLI clients, and future debugger integrations.

The useful property of Chrome DevTools Protocol for this project is its debugging model—targets, sessions, domains, generic commands, asynchronous events, and discoverable protocol schema—not Chromium-specific domains or Chrome DevTools Frontend compatibility.

## Proposal

Adopt the architecture described in [CDP-shaped Agent Debug Protocol](../../../../docs/cdp-shaped-agent-protocol.md).

The primary Agent transport remains MCP, but the Host exposes a transport-neutral DevTools Protocol Core with CDP-shaped JSON command/response/error/event frames. The first domains are `Schema`, `Target`, `Cordis`, `Fiber`, and `Profiler`. Cordis-specific concepts stay in Cordis-specific domains rather than being disguised as unrelated standard CDP browser concepts.

The preferred MCP surface becomes a small set of protocol primitives: protocol discovery, target discovery, attach, generic `send`, bounded event read, bounded event wait, and detach. Existing focused MCP tools remain as compatibility/convenience adapters during migration. Adding a new protocol command should not normally require adding a new MCP tool name.

The existing Host runtime model remains authoritative. The implementation reuses the current `RuntimeNotificationSource`, target/session lifecycle, bounded observation journal, monotonic sequence/gap semantics, `RuntimeDiagnosticsQuery`, and `WaterfallExperimentCoordinator`. It must not create a second collector, target registry, journal, trace store, or profiler ownership state machine.

Version 1 protocol events map only facts already emitted authoritatively by the Host: dispatch observed, topology invalidated, profiler trace updated, profiler status changed, and target destroyed. More granular Fiber/listener lifecycle events are deferred until Cordis provides sufficient authoritative signals.

Snapshot/event synchronization uses a pre-snapshot journal barrier: record the current sequence, build the authoritative snapshot, and return both. Events that occur during snapshot construction may later be observed redundantly, but they cannot be silently skipped. A cursor outside the bounded retained window produces an explicit gap and requires a fresh snapshot.

Profiler mutation remains explicit and separate from domain event subscription. Starting/stopping instrumentation continues through the existing coordinator with current authentication/capability gates, finite leases, and exact-owner cleanup; a generic domain `enable` must not silently start instrumentation.

A raw CDP-style WebSocket adapter is intentionally deferred but its compatibility constraints are designed now. A future adapter may expose `/json/version`, `/json/list`, `/json/protocol`, and a target-scoped `/devtools/page/{targetId}` WebSocket using the same protocol schema and frame types. It must preserve loopback/authentication policy, bounded backpressure, session cleanup, sequence/gap recovery, and must not claim Chrome DevTools Frontend compatibility.

This proposal extends the current v0.8 architecture's deferred-native-protocol section without changing the current product fact that MCP is the primary Agent surface until the protocol implementation ships.

## Alternatives considered

**Keep the existing MCP tools and only add realtime browser SSE/WebSocket notifications.** Rejected as the main direction because it solves browser freshness but leaves Agent debugging fragmented. New debugger capabilities would continue expanding the MCP tool namespace, and Agents could not dynamically discover a coherent command/event protocol.

**Implement a raw CDP WebSocket endpoint first and require Agents to use it.** Rejected because most MCP-capable coding Agents operate through bounded tool calls rather than owning arbitrary long-lived WebSocket consumers. The existing sequence + bounded journal + long-poll model is already better suited to Agent turns. WebSocket should be an adapter over the same core when a concrete external client needs it.

**Implement full Chrome DevTools Protocol compatibility.** Rejected because Cordis has no truthful equivalents for browser-specific `DOM`, `Page`, `Network`, `Debugger`, or V8 execution-context semantics. Emulating them would create false diagnostics and large maintenance cost merely to satisfy a frontend designed for Chromium.

**Invent a completely custom DSH/Cordis wire protocol without CDP-shaped messages.** Rejected because CDP's command/event/domain/session shape is already well understood, extensible, and suitable for generic tooling. The project benefits from that model without inheriting browser semantics.

**Immediately replace all existing MCP tools with generic protocol primitives.** Rejected because it creates unnecessary compatibility risk. Existing focused tools can delegate to the same core while the packaged Skill and new Agent workflows migrate first.

## Acceptance criteria

- A transport-neutral protocol schema describes `Schema`, `Target`, `Cordis`, `Fiber`, and `Profiler` commands/events and is available to Agents at runtime.
- Commands, responses, errors, and events use one CDP-shaped JSON envelope across adapters.
- An Agent can use target discovery → attach → generic command → event wait/read → exact query → detach without learning a new MCP tool for each domain command.
- Event consumption preserves monotonic sequence, bounded retention, explicit gap reporting, and cancellation on detach/expiry/replacement/disposal.
- Snapshot + cursor behavior cannot silently miss a change that happens while a snapshot is being constructed.
- Version 1 events contain only facts supported by current authoritative Host notifications; unsupported granular transitions remain absent rather than inferred.
- Profiler mutation continues through the one existing coordinator and preserves current lease/security semantics.
- Existing focused MCP tools remain functional during migration and do not own parallel debugger state.
- Browser migration can consume the same protocol contracts instead of introducing another runtime model.
- The shipped product makes no claim of Chrome DevTools Frontend, Chromium domain, or `chrome://inspect` compatibility.
- The deferred WebSocket adapter can reuse the same schema/core without changing command/event semantics.

## Risks

**Protocol abstraction could duplicate existing Agent Debug state.** The implementation must evolve or wrap the existing single owner rather than adding another target/session/journal/lease subsystem.

**Generic `send` can make the Agent surface harder to discover if schema descriptions are weak.** Runtime protocol introspection is therefore required, with useful command/event descriptions and machine-readable parameter/result contracts. The packaged Skill should teach a discover-first workflow rather than hard-code every command.

**Snapshot/event races can create false confidence.** The event cursor must be captured with defined ordering relative to snapshot construction, and gap recovery must remain explicit. Retained absence must never be presented as complete history.

**Domain `enable` semantics could accidentally become instrumentation mutation.** Low-cost event subscription and profiler experiment mutation must remain separate contracts.

**CDP-shaped naming may be mistaken for full CDP compatibility.** Documentation, protocol metadata, and future discovery endpoints must state that only the JSON/debugging model is compatible; Chromium-specific semantics and Chrome DevTools Frontend support are out of scope.

**A future WebSocket endpoint creates authentication and backpressure concerns.** It remains deferred until there is a concrete consumer and must reuse loopback/token policy, use bounded outbound buffering, close slow consumers explicitly, and support sequence/snapshot recovery rather than silent loss.
