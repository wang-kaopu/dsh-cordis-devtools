# Architecture: DSH DevTools for Agents (v0.8)

## Product boundary

dsh-cordis-devtools is an Agent-facing runtime debugging product for a live
DeepSeek Harness (DSH) / Cordis process. MCP is the primary Agent surface; a
focused CLI and an installable debugging Skill are clients of the same MCP
tools. Agent hosts can connect through the package-local stdio bridge, which
forwards authenticated loopback HTTP MCP without exposing token material to
the model. Profile-scoped setup, doctor, and token rotation own this local
bootstrap lifecycle. The runtime is the source of truth, and the product
exposes bounded, metadata-only evidence plus controlled profiling.

The intended workflow is:

~~~text
discover target → attach session → explore snapshot → wait for change
→ inspect exact evidence → checkpoint/compare → optionally profile
→ report bounded facts → detach
~~~

This is not a general DSH control plane or a claim of Chrome CDP
compatibility. v0.8 does not provide automated root-cause diagnosis, source
editing, reload/reproduction, dispatch injection, breakpoints, pause/resume,
expression evaluation, payload capture, or a complete audit log.

## Runtime and adapter topology

~~~text
                              Live Cordis runtime
                                      │
        ┌─────────────────┬───────────┼───────────┬──────────────────┐
        ▼                 ▼           ▼           ▼                  ▼
  Collector          TraceStore   Coordinator  Diagnostics       Cordis adapter
 topology/history    bounded      one mutation  read facts       internal seam
        └─────────────────┴───────────┼───────────┴──────────────────┘
                                      ▼
                         RuntimeNotificationSource
                         metadata-only fan-out
                                      ▼
                         ┌────────────────────────┐
                         │  Agent Debug Core       │
                         │  target/session ids     │
                         │  snapshot projection   │
                         │  bounded journal/wait  │
                         │  session-owned leases  │
                         └───────────┬────────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       ▼                             ▼                             ▼
 MCP (primary)             DSH Cordis Inspect / tools        Browser RPC / UI
 Streamable HTTP           existing in-process adapters       existing human UI
       ▼                             ▼                             ▼
 dsh-cordis-debug CLI       DSH Agent workflows             Fibers/events/profiler
 + dsh-runtime-debugging Skill

 Agent host
       │ stdio MCP
       ▼
 dsh-cordis-devtools-mcp
       │ authenticated loopback HTTP MCP
       └──────────────────────────────► MCP (primary)

                 future native DSH protocol / IDE client
                 raw WebSocket/CDP wire compatibility deferred
~~~

The Host seams are isolated in
[src/host/cordis-adapter.ts](../src/host/cordis-adapter.ts),
[src/host/collector.ts](../src/host/collector.ts),
[src/host/trace-store.ts](../src/host/trace-store.ts), and the existing
diagnostics/experiment services. Agent composition is under
[src/host/agent-debug/](../src/host/agent-debug/). Shared contracts are in
[src/shared/agent-debug.ts](../src/shared/agent-debug.ts) and contain no MCP,
HTTP, DSH, Cordis, CLI, or WebSocket implementation types.

## Agent Debug Core

AgentDebugService is the single Host-owned composition point. It receives
authoritative observer/profiler snapshots, one RuntimeNotificationSource, and
ports to the existing experiment coordinator. It owns target/session identity,
catalog cursors, the bounded observation journal, wait cancellation, and
session-to-experiment lease association. It does not traverse Cordis twice and
does not create a second profiler, checkpoint diff, or ownership state machine.

### Target and session identity

v0.7 exposes one active cordis-runtime target. Each target has opaque targetId,
monotonic targetEpoch, status, safe title/version metadata, and capabilities:
target-discovery, debug-session, runtime-snapshot, runtime-wait,
checkpoint-compare, and waterfall-profiler.

Replacement creates a fresh id/epoch and never silently rebinds an old id.
Sessions attached to the old incarnation become stale with a factual reason:
target-replaced, target-disposed, or host-disposed. Multi-process aggregation,
LAN/remote discovery, auto-attach, and multiple live targets are deferred.

cordis_attach_debug_session returns an opaque debugSessionId bound to the exact
target id/epoch. MCP transport sessions are not DSH debug sessions; every
session-aware request carries its explicit id. A session owns its observation
sequence, catalog cursors, pending-wait cancellation, timestamps, and any
experiment lease it starts. Sessions are capped at 32 and idle-expire after
15 minutes by default. Detach, expiry, target replacement, and Host disposal
release waiters/cursors and perform exact-owner lease cleanup; coordinator TTL
is the profiling fail-safe.

### Exploration snapshot and bounded facts

cordis_debug_snapshot projects selected authoritative metadata sections:

~~~text
summary       counts and retained-window metadata
events        event names and listener multiplicities
fibers        live Fiber names, state, parent, and ownership counts
dispatches    recent retained dispatch overview
profiler      instrumentation state and retained trace count
candidates    mechanical evidence groupings
~~~

Catalogs page at most 100 items and return total, returned, truncated, cursor,
and nextCursor facts. Cursors are session-owned and capped at eight. Mechanical
candidates may group duplicate live Fiber names, equivalent registrations,
orphaned listener owners, repeated/late next() facts, or instrumentation
conflict/unsupported state. They never claim root cause, confidence, fixed, or
remediation.

RuntimeDiagnosticsQuery remains the implementation for exact Event/Fiber
inspection, bounded dispatch/trace searches, and caller-owned semantic
checkpoint comparison. It remains read-only and does not infer repair success.

### Notification source, journal, and wait

[src/host/runtime-notifications.ts](../src/host/runtime-notifications.ts) emits
four typed metadata-only host facts:

~~~text
dispatch-observed       pre-execution internal/dispatch fact
topology-invalidated    authoritative topology should be queried again
profiler-trace-updated  retained trace changed
profiler-status-changed instrumentation ownership/state changed
~~~

The source only fans out. Target disposal is not a source notification:
AgentDebugService appends target-disposed itself when its target registry
reports replacement or disposal. The Core then appends all five observation
kinds to one target-local monotonic journal capped at 500 records, with at
most 32 pending waiters. dispatch-observed is not completion or
listener-execution evidence; topology-invalidated is not a synthetic diff.

cordis_wait_for_runtime_change accepts an exact type/event filter, optional
afterSequence, and a bounded timeout (15 seconds default, 60 seconds maximum).
It returns found, timeout, or gap plus oldest/newest sequence, retained count,
truncated/gap facts, and the updated session. An old cursor returns gap;
bounded absence never means “never happened”. Detach and Host disposal cancel
pending waits. Long-polling makes observations usable through normal MCP
calls without requiring model hosts to consume arbitrary server push.

## MCP-first Agent surface

MCP is enabled only with mcp.enabled: true in [src/index.ts](../src/index.ts).
It serves Streamable HTTP at /mcp, binds only to 127.0.0.1, defaults to port
43127, and is implemented by [src/host/mcp.ts](../src/host/mcp.ts). Agent Debug
tools are exposed when MCP is enabled:

~~~text
cordis_list_debug_targets
cordis_attach_debug_session
cordis_debug_snapshot
cordis_wait_for_runtime_change
cordis_detach_debug_session
~~~

Existing focused tools remain available and keep their names:

~~~text
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
~~~

The adapter validates request schemas and routes to the Core; it does not own
a second target, journal, snapshot projection, or coordinator. Read-only MCP
requests may run without a token for local development. If configured, a
bearer token is required on every request. `mcp.tokenFile` is the bootstrap
path's owner-only credential source and takes precedence over inline `mcp.token`;
the token file is read by the Host without being transported in diagnostics.
Experiment mutation additionally requires a non-empty token and
mcp.experiments.enabled: true. External MCP has no truthful DSH Agent identity
and does not use ctx.approval; DSH-native experiment tools retain their
one-shot approval gate.

## Existing adapters and clients

The package-local `dsh-cordis-devtools-mcp` bin is a stdio MCP server and lazy
Streamable HTTP client. It reads the owner-only token file only when opening
or re-opening the DSH connection, forwards the existing tool schemas/results,
and never automatically retries or replays a failed tool call. A profile
`setup --agent codex` command writes the selected patch/token file and invokes
Codex registration; `doctor` performs secret-free authenticated discovery, and
`rotate-token` replaces the token while leaving normal DSH reload under user
control. The manual HTTP MCP route remains supported. This repository's
package-local bin is not an `npx` publication claim.

[src/host/cordis-inspect.ts](../src/host/cordis-inspect.ts) remains a
read-only CordisRuntime provider and preserves existing discovery/query
behavior. The DSH waterfall tools remain the in-process mutation entry and
require the real DSH Agent identity plus one-shot approval before coordinator
mutation.

[src/host/rpc.ts](../src/host/rpc.ts) retains loopback snapshot, profiler
snapshot, and Human instrumentation endpoints. The browser UI retains its
observer/profiler behavior and Human emergency stop; it consumes Host-owned
state and does not need MCP session ids.

The published dsh-cordis-debug binary is an MCP client, not a runtime
implementation. It uses the official Streamable HTTP client, requires
--endpoint/--token or DSH_CORDIS_DEBUG_ENDPOINT/DSH_CORDIS_DEBUG_TOKEN, and
keeps the endpoint loopback-only. Commands are targets, snapshot, event
<name>, fiber (--uid <uid> | --name <name>), watch, checkpoint, compare, and
profile. Transient sessions are detached in a finally path. Implementation:
[src/cli.ts](../src/cli.ts) and [src/cli/program.ts](../src/cli/program.ts).

[skills/dsh-runtime-debugging/SKILL.md](../skills/dsh-runtime-debugging/SKILL.md)
teaches discovery, exact inspection, bounded wait/gap recovery,
checkpoint/compare, finite profiling, and stale target/session recovery. It
separates runtime evidence from source diagnosis/remediation and contains no
hidden mutation.

## Controlled experiments

WaterfallExperimentCoordinator is the sole production instrumentation mutation
owner. Human RPC, DSH tools, MCP tools, and Core session methods delegate to
it. Only one owner exists at a time. Agent leases have finite TTL (15 seconds
default, 60 seconds maximum), exact lease-id stops, and exact-owner cleanup.
Human emergency stop may always reduce instrumentation; an Agent cannot steal
Human ownership. Agent traces may carry the exact lease id as experimentId.
Trace storage is bounded at 200 traces by default and is not a lossless log.

## Evidence, privacy, and lifecycle contracts

Observer mode never wraps target callbacks, replaces dispatch, or changes
Cordis semantics. Direct Cordis internals remain isolated in the adapter.
Unsupported completion, listener identity, return, next(), and short-circuit
claims remain unknown.

Snapshots, checkpoints, observations, and traces exclude raw arguments/returns,
error objects/messages, prompts, tool outputs, file contents, plugin config,
secrets, bearer tokens, and raw Effect function/disposer references. Dispatch
history (500), traces (200), journal records (500), waiters (32), sessions
(32), cursors (8/session), catalogs (100/page), request bodies (1 MiB), and
waits (60 seconds) are bounded. Results expose window/truncation/gap facts;
retained absence is never presented as complete history.

DevtoolsService disposal releases notification subscriptions, session timers,
waiters, cursors, MCP resources, and leases in owner-safe order. Startup
failure is isolated from the Human observer path unless failOnStartupError is
explicitly enabled. Core invariants are: observer behavior-neutrality; exact
diagnostics/verification read-only; one coordinator mutation owner; explicit
non-rebound ids; bounded metadata-only evidence; visible unknown/stale/conflict/
timeout/gap facts; and no automated diagnosis or fix-success claim.

## Test and verification layers

1. Pure unit tests cover contracts, ring buffers, snapshot/candidate projection,
   target/session lifecycle, journal sequence/gaps, cancellation, and leases.
2. Host integration uses real @deepseek-ai/cordis for listener/Fiber lifecycle
   and dispatch observation semantics.
3. MCP/CLI tests verify exact tool names/schemas, authentication, routing,
   bounded waits, cleanup, and CLI detach/error paths.
4. DSH Inspect and browser RPC tests protect existing adapter behavior and
   Human emergency-stop recovery.
5. Build and packed-artifact smoke tests exercise exports, CLI bin, packaged
   Skill, plugin loading, and MCP behavior.
6. Real DSH E2E covers discovery, attach, snapshot, wait, checkpoint/compare,
   approved finite profiling, exact trace retrieval, detach/expiry cleanup,
   and Human UI recovery.
7. Repository gates include typecheck, build, tests, client-bundle, policy/note,
   and relative-link verification.

Examples:
[tests/agent-debug-service.spec.ts](../tests/agent-debug-service.spec.ts),
[tests/mcp-agent-debug.spec.ts](../tests/mcp-agent-debug.spec.ts),
[tests/agent-debugging-proof.spec.ts](../tests/agent-debugging-proof.spec.ts),
[tests/cli-program.spec.ts](../tests/cli-program.spec.ts), and
[e2e/controlled-experiment-smoke.mjs](../e2e/controlled-experiment-smoke.mjs).

## Publication and artifact boundaries

The package boundary is defined by [package.json](../package.json): compiled
lib, cordis.patch.yml, README.md, LICENSE, and skills are published; the
dsh-cordis-debug bin resolves to lib/cli.js and the
dsh-cordis-devtools-mcp bin resolves to lib/bridge-entry.js. The public module exports shared
Agent Debug contract types/constants and existing service contracts. Host
implementation files and test fixtures are not a second public runtime API.

The embedded MCP endpoint exists only in a configured live plugin and is not a
standalone published server. CLI and Skill are workflow/client layers over
MCP. Packed-artifact tests must exercise the compiled CLI entry, included
Skill, plugin loading, and MCP behavior; source imports alone are insufficient.
npm publication, tags/releases, and remote deployment are release-process
boundaries, not implied by a local build or this document.

## Deferred native protocol

The Core leaves room for a native DSH Debug Protocol for an IDE or dedicated
debugger. v0.8 does not add a WebSocket listener, /json/list, /json/version,
raw event push, or CDP wire compatibility. It does not claim an MCP-native
Agent can consume an arbitrary custom WebSocket without a client adapter.

A native protocol needs a separate decision for transport, discovery,
authentication, concurrent sessions, notification/backpressure semantics,
versioning, and real-client tests. Add it only for a concrete non-MCP consumer;
MCP remains the primary Agent product surface.

## Related decisions

- [docs/defensive-patterns.md](./defensive-patterns.md)
- [docs/development-workflow.md](./development-workflow.md)
- [docs/v0.6-controlled-runtime-experiments.md](./v0.6-controlled-runtime-experiments.md)
- [skills/dsh-runtime-debugging/SKILL.md](../skills/dsh-runtime-debugging/SKILL.md)
