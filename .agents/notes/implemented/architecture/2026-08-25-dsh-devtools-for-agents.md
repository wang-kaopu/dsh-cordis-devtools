# Agent Note: DSH DevTools for Agents

Status: implemented

## Problem

The current repository gives DSH and external Agents authoritative Cordis runtime facts, caller-owned before/after verification, and one authority-gated waterfall experiment. The external MCP surface is already the right interoperability mechanism for coding Agents, but most tools expose low-level factual queries. An Agent must already know exact Event/Fiber names, repeatedly poll retained windows, manually coordinate checkpoints and experiments, and infer an effective debugging workflow from documentation.

Chrome DevTools Protocol is not itself the complete Agent product. Chrome DevTools for Agents places an MCP server, a focused CLI, and Agentic Skills above the browser protocol. The MCP layer owns browser connection and target state and exposes task-sized operations such as listing pages, taking a semantic snapshot, waiting for a condition, reading recent console/network evidence, and running/analyzing a trace. Skills teach the Agent how to combine those tools into a repeatable debugging workflow.

Building a public CDP-shaped WebSocket before those Agent-facing layers would improve protocol mechanics without closing the primary user gap. Codex and other coding Agents would still need a custom client or bridge, while the existing MCP client path would remain the easiest way for them to use DSH.

The project is **DSH DevTools for Agents**: MCP-first runtime debugging tools, a focused CLI, and an installable debugging Skill over one Host-owned debug core. A raw DSH debugging WebSocket may later expose that core to IDEs and dedicated debuggers, but it is not part of v1.

## Decision

### Make MCP the primary Agent product surface

The implementation keeps the embedded Streamable HTTP MCP server and all existing tool names/schemas, and adds an Agent-debugging tool family that supports an explicit, resumable workflow:

```text
cordis_list_debug_targets
cordis_attach_debug_session
cordis_debug_snapshot
cordis_wait_for_runtime_change
cordis_detach_debug_session
```

The current tools remain the focused evidence and mutation vocabulary:

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
cordis_capture_checkpoint
cordis_compare_current
cordis_waterfall_experiment_status
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

The new tools do not duplicate those queries. They add target discovery, explicit observation-session ownership, an exploration snapshot, and one bounded wait primitive. Existing tools gain optional `targetId` / `debugSessionId` routing only where needed without breaking their existing single-runtime input schemas.

MCP transport sessions are not treated as DSH debug sessions. `cordis_attach_debug_session` returns an opaque Host-owned `debugSessionId`; later calls carry that id explicitly. This works with request-scoped or stateless MCP transports and lets multiple Agents/subagents share one MCP server without sharing implicit selected-target state.

### Use a transport-neutral Agent Debug Core

A Host-owned core sits below MCP, DSH Cordis Inspect, DSH experiment tools, the browser RPC, and the CLI:

```text
Cordis runtime
    |
ObserverCollector / TraceStore / WaterfallExperimentCoordinator
    | authoritative facts, bounded histories, controlled mutation
    v
Agent Debug Core
    |- target registry
    |- debug-session registry
    |- compact snapshot/query facade
    |- bounded observation journal + waiters
    `- immutable adapter authority context
    |
    |- MCP Agent tools (primary)
    |- DSH Cordis Inspect / approved tools
    |- focused CLI through MCP
    |- Human browser RPC
    `- future native debugging protocol
```

`RuntimeDiagnosticsQuery` remains the single targeted query/checkpoint implementation. `WaterfallExperimentCoordinator` remains the only production instrumentation-mutation owner. The new core composes those facts into Agent-oriented operations but does not implement a second Cordis traversal, checkpoint diff, profiler store, or ownership state machine.

Shared contracts contain no MCP, HTTP, DSH, Cordis, CLI, or WebSocket implementation types. Adapters authenticate and authorize callers before passing an immutable authority context; command arguments cannot grant or upgrade authority.

### Expose one explicit target and resumable observation sessions

Each activated `DevtoolsService` exposes one `cordis-runtime` target in v1:

```text
targetId
targetEpoch
title/type
plugin and Cordis versions when authoritative
supported capabilities
```

Host reload creates a new target id/epoch. Old debug sessions become stale and cannot silently attach to the replacement runtime. Multi-process aggregation, remote/LAN discovery, and auto-attach remain deferred.

A debug session owns:

- its target/epoch;
- creation and last-access timestamps;
- a monotonic observation cursor;
- exact Event/type filters for waits;
- bounded temporary catalog cursors when required;
- leases created through that session, when the caller has experiment authority.

Debug sessions have an explicit maximum idle lifetime and capacity. Explicit detach, idle expiry, or Host disposal cancels waiters, drops cursors, and performs exact cleanup of any still-owned experiment lease. The existing experiment TTL remains the fail-safe; stale cleanup cannot disable a later Agent or Human owner.

### Provide an Agent-oriented snapshot without inventing diagnosis

`cordis_debug_snapshot` gives an Agent enough names and relationships to begin exploration without prior Event/Fiber knowledge. It returns metadata-only sections selected by input:

```text
summary
Event catalog and listener multiplicities
live Fiber catalog and owner relationships
recent retained dispatch overview
profiler/experiment status
mechanical anomaly candidates
```

Mechanical anomaly candidates may report facts such as:

- multiple live same-name Fibers;
- multiple semantically equivalent listener registrations;
- listener owners no longer present in the authoritative live Fiber inventory;
- retained traces with repeated or late `next()` calls;
- current instrumentation conflict/unsupported state.

They never emit `rootCause`, `fixed`, confidence, or an automatic remediation. Candidate grouping reuses the same semantic identities as Runtime Verification where applicable. Unknown and bounded evidence remain explicit.

Catalogs and anomaly lists have explicit limits, returned/total/truncated facts, and optional session-owned cursors. No response silently truncates current topology.

### Use bounded long-poll waits instead of exposing raw event push to the model

The observer/trace/coordinator seams emit typed metadata-only notifications into one Host-owned bounded observation journal with a target-local monotonic sequence.

V1 observation types are:

```text
dispatch-observed
topology-invalidated
profiler-trace-updated
profiler-status-changed
target-disposed
```

`cordis_wait_for_runtime_change` accepts `debugSessionId`, `afterSequence`, exact type/Event filters, and a bounded timeout. It returns the first matching retained observation or a factual timeout result. It also returns journal window metadata including oldest/newest sequence, bounded, truncated, and gap. A cursor older than the retained window produces an explicit gap instead of pretending no event occurred.

This wait tool converts server-side observation into a normal Agent tool call. It avoids requiring the model host to consume arbitrary WebSocket notifications, does not block Cordis dispatch, and works with existing MCP clients. Multiple waiters and session queues are bounded; detach/dispose aborts pending waits.

`dispatch-observed` remains the pre-execution `internal/dispatch` fact. `topology-invalidated` says authoritative topology should be queried again and does not fabricate a precise diff. Trace/status observations originate from explicit trace-store/coordinator notifications rather than polling inference.

The journal never stores raw event arguments, returns, error objects/messages, prompts, tool results, file contents, configuration, credentials, bearer tokens, or raw Effect functions/disposers.

### Keep authority and controlled experiments unchanged in principle

Read-only debug-session tools do not enable instrumentation. DSH experiment start still requires real one-shot `ctx.approval`; Cordis Inspect remains read-only. External MCP experiment mutation remains hidden by default and requires the existing non-empty bearer token plus explicit experiment capability.

When an authenticated MCP caller starts an experiment through a debug session, the lease is associated with that exact session for detach/expiry/Host-disposal cleanup and trace attribution. Human emergency stop remains authoritative. Generic event execution, service/config mutation, lease renewal, multiple concurrent leases, payload capture, and automatic reload remain outside v1.

### Ship a focused CLI over the same MCP surface

The package ships a `dsh-cordis-debug` CLI entry point using the official MCP SDK client against the embedded loopback endpoint. The CLI is a client, not another runtime implementation. It exposes a targeted subset suitable for shell automation and troubleshooting:

```text
dsh-cordis-debug targets
dsh-cordis-debug snapshot
dsh-cordis-debug event <name>
dsh-cordis-debug fiber (--uid <uid> | --name <name>)
dsh-cordis-debug watch [--event <name>] [--timeout <ms>]
dsh-cordis-debug checkpoint [--output <file>]
dsh-cordis-debug compare --baseline <file>
dsh-cordis-debug profile --ttl <ms>
```

The CLI requires explicit endpoint/token configuration, prints bounded/gap semantics, and uses files only when the user explicitly requests checkpoint/trace output. It does not start or discover arbitrary DSH processes, widen the server beyond loopback, or bypass MCP authority.

### Ship an installable DSH runtime-debugging Skill

The package includes a portable Agent Skill that teaches coding Agents how to use the MCP tools for evidence-based workflows:

- duplicate Fiber/listener diagnosis;
- lifecycle leak verification;
- event-not-observed vs never-happened handling;
- checkpoint before normal edit/reload and semantic compare afterward;
- short approved waterfall profiling;
- repeated/late `next()` investigation;
- stale target/session and observation-gap recovery.

The Skill does not contain hidden mutation, replace source analysis, or instruct the Agent to treat mechanical candidates as root cause. Installation documentation covers Codex and generic MCP-capable Agent clients. Repository-development skills under `.agents/skills` remain separate from this end-user debugging Skill.

### Defer the native DSH Debug Protocol WebSocket

The Agent Debug Core is designed so a later native protocol can expose target/session/domain/notification semantics to IDE extensions, dedicated debuggers, and non-MCP clients. V1 does not add `/json/list`, a WebSocket listener, or claim CDP wire compatibility.

A native protocol becomes justified when there is a concrete non-MCP consumer or when the Human DevTools UI needs server push that cannot be supported through the existing DSH Connection infrastructure. That future change requires its own transport, authentication, backpressure, compatibility, and real-client decision.

### Maximize parallel implementation after the shared contract freezes

Implementation follows this dependency DAG:

```text
proposal approval
    |
shared target/session/observation contracts
    |
    +--> target + debug-session registry -------+
    +--> typed observer/trace/status sources ----+--> Agent Debug Core composition
    +--> snapshot/anomaly projection ------------+             |
    +--> MCP schema/tool definitions ------------+             |
                                                               +--> MCP live wiring
                                                               +--> DSH adapter parity
                                                               +--> CLI client
                                                               +--> packaged Skill/docs
                                                                          |
                                                             real DSH + packed-artifact E2E
```

After the shared vocabulary is approved and frozen, independent Luna tasks use disjoint production/test files. `src/index.ts`, `src/host/service.ts`, `src/host/mcp.ts`, `package.json`, the lockfile, and this Agent Note each have one designated owner. Integration gates run after the shared contract, after core composition, and before real DSH E2E. Write-heavy tasks touching a shared file remain sequential.

## Alternatives considered

### Build a public CDP-shaped WebSocket first

Rejected for v1. It would provide target/session/notification mechanics to custom clients but would not make those capabilities directly discoverable by MCP-native coding Agents. The project currently has no concrete IDE/debugger consumer that requires a raw socket. The transport-neutral core preserves this future option without putting it on the critical path.

### Keep only the existing low-level MCP queries

Rejected. They expose good evidence but require the Agent to know exact runtime names and manually coordinate polling, checkpoints, and experiments. A compact discovery snapshot, explicit debug session, bounded wait, CLI, and Skill materially improve the Agent debugging workflow without broad runtime mutation.

### Mirror every internal protocol command as one MCP tool

Rejected. Chrome DevTools for Agents exposes task-sized tools rather than forcing the model to operate every low-level protocol event directly. DSH tools should preserve useful focused queries while adding a small number of workflow primitives, not generate an unbounded one-tool-per-command surface.

### Use implicit globally selected target/session state

Rejected. Multiple Agents or subagents can share one embedded server. Explicit target and debug-session ids make routing, cleanup, stale ownership, and test evidence factual rather than depending on whichever caller most recently changed global selection.

### Push every runtime event directly through MCP notifications

Rejected for v1. Agent hosts vary in notification exposure and model-context behavior. A bounded `wait_for_runtime_change` tool gives the model a normal, cancellable call with explicit cursor/gap semantics while keeping the observation journal transport-neutral.

### Add automatic root-cause diagnosis

Rejected. The core may group mechanically suspicious facts, but source analysis and model reasoning determine root cause. The runtime must not manufacture diagnosis, confidence, or fix-success claims.

### Add arbitrary dispatch, evaluation, reload, pause, or breakpoints

Rejected for v1. These are materially broader mutation/debugger semantics with separate lifecycle, privacy, and authority requirements. The first Agent product should make existing authoritative inspection, verification, and controlled profiling substantially easier to use.

### Implement the CLI directly against Cordis internals

Rejected. A standalone process does not own the live runtime. The CLI must use the same authenticated MCP adapter and Host-owned debug core as every other external Agent client.

## Consequences

- An MCP-native coding Agent can discover the current Cordis runtime, attach an explicit debug session, obtain an exploratory metadata-only snapshot, wait for a filtered runtime change, inspect focused evidence, verify before/after topology, run an authorized finite waterfall experiment, and detach without a custom WebSocket client.
- Existing MCP tool names, Cordis Inspect methods, browser UI/RPC behavior, bounded evidence semantics, and experiment authority remain backward-compatible.
- Debug sessions and target ids are explicit, connection-independent handles with bounded capacity, idle expiry, stale-target detection, lifecycle-owned wait cancellation, and exact experiment cleanup.
- Snapshot catalogs expose enough Event/Fiber names and ownership relationships for cold-start exploration. Limits, cursors, truncation, expiry, and observation gaps are machine-visible.
- Mechanical anomaly candidates are reproducible transformations over authoritative metadata and never claim root cause, confidence, or successful repair.
- `cordis_wait_for_runtime_change` proves an enable/sequence barrier, factual timeout, exact filters, bounded journal gaps, concurrent waiter limits, cancellation, detach, and Host disposal behavior.
- Observer mode still does not wrap target callbacks or replace dispatch. Dispatch observations remain pre-execution facts. No sensitive payload/error/file/config/token data is captured by default.
- DSH approval, external MCP auth/capability, single coordinator ownership, exact lease stop, TTL cleanup, stale-stop safety, Human emergency stop, and trace attribution remain authoritative.
- `dsh-cordis-debug` uses the official MCP client and covers discovery, snapshot, watch, verification, and profiling without duplicating runtime traversal or authority.
- The packaged debugging Skill gives an Agent concrete workflows and explicitly teaches bounded/unknown/root-cause limitations.
- Unit tests cover contracts, target/session lifecycle, snapshot projection, anomaly grouping, observation sequence/gaps, wait cancellation, authority denial, and adapter parity.
- The real DSH smoke scripts exercise the MCP Agent workflow through the built plugin: discover, attach, snapshot, wait for a real Cordis observation, checkpoint/compare, approved finite experiment, exact trace retrieval, detach/expiry cleanup, and existing Human UI recovery. The acceptance run was blocked before DSH startup because the upstream DSH `pnpm dlx` dependency requested `@aws-sdk/token-providers@3.1116.0` while the configured registry exposed only up to `3.1111.0`.
- Policy, links, typecheck, 192 unit/integration tests, build, client-bundle validation, CLI/package-entry tests, and Skill validation pass without weakening existing gates. The real DSH smoke dependency-resolution limitation remains explicit rather than being reported as passing evidence.

### Operational consequences and risks

- Agent-oriented snapshot and anomaly aggregation can drift into unprovable diagnosis. Contracts, naming, tests, and Skill wording must keep them mechanical and evidence-only.
- Long-poll waits introduce pending-request, cancellation, waiter-limit, and Host-shutdown behavior. All waiters, sessions, cursors, timers, and journal histories require explicit capacities and lifecycle disposal.
- Explicit debug sessions add server-side state above a stateless MCP transport. Idle TTL, maximum sessions per target/caller, stale-target errors, and exact cleanup must be enforced rather than relying on client cooperation.
- The initial single target can make target discovery look ceremonial. Keeping explicit routing is still necessary for reload identity and future multi-runtime support, but multi-process behavior must not be implied.
- Adding an npm CLI binary and packaged Skill changes the published artifact surface. Package exports/files, executable permissions, install documentation, and packed-plugin smoke coverage are required.
- Refactoring existing MCP/DSH adapters onto a shared core can accidentally change established schemas or authority behavior. Compatibility tests and the existing real DSH smokes are mandatory regression evidence.
- Parallel implementation increases integration risk around shared contracts and central wiring. Contract freeze, designated ownership of conflict-hot files, and explicit integration gates are required.
