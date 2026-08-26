# DSH DevTools for Agents

Agent-oriented runtime inspection and debugging for DeepSeek Harness / Cordis. The product surface is MCP plus a small JSON CLI and an installable debugging Skill; the Host remains the source of truth for live Events, listeners, Fibers, dispatch history, verification checkpoints, and controlled waterfall profiling.

> Current feature line: **v0.8 — Local Agent Bridge & Bootstrap**. v0.8 adds the package-local stdio bridge, profile-scoped `setup` / `doctor` / `rotate-token`, owner-only `mcp.tokenFile` storage, and Codex registration over the v0.7 Agent Debug workflow. Diagnostics and Runtime Verification remain read-only; waterfall profiling remains a separate finite, authority-gated experiment.
>
> Repository readiness does **not** imply that an npm package, Git tag, or GitHub Release has been published.

## Current capabilities

- Live Event / Listener Registry backed by the real Cordis listener registry.
- Listener execution order, `prepend` / `global`, and owning Fiber metadata.
- Authoritative live Fiber Registry backed by `ctx.registry`, including parent/inject metadata and labeled effect trees from `fiber.getEffects()`.
- Cross-view navigation between listener owners, dispatch contexts, Fibers, and owned Events.
- Bounded observer Dispatch Timeline with invocation mode and dispatch-context metadata.
- Explicit opt-in **Waterfall Profiler** with entered listener spans, timing facts, outcome categories, repeated/late `next()` call records, and owner → Fiber navigation.
- Bounded profiler trace retention separated from the observer snapshot path.
- One DSH sidebar DevTools surface with `Events`, `Timeline`, `Fibers`, and `Profiler` views.
- Shared transport-neutral **Runtime Diagnostics Query** layer for targeted runtime summary, Event, Fiber, dispatch, and profiler-trace reads.
- Versioned, caller-owned **Runtime Verification checkpoints** plus semantic before/after diff over authoritative current topology.
- Multiplicity-preserving Event / Listener / Fiber comparison that ignores runtime-local id/uid churn and capture-local listener order as cross-checkpoint identity.
- DSH-native `CordisRuntime` Inspect Provider through the existing first-party `cordisInspect` registry.
- Optional embedded **MCP Streamable HTTP** endpoint for external coding agents, loopback-only and disabled by default.
- Agent Debug target discovery and opaque target epochs so a reload/disposal cannot silently reuse an old runtime identity.
- Bounded Agent Debug sessions with explicit attach/detach, idle expiry, stale-target state, and cleanup of session-owned waits, cursors, and experiment leases.
- Metadata-only cold-start runtime snapshots with bounded, cursor-paged Event, Fiber, dispatch, profiler, and mechanical-candidate sections.
- Resumable `cordis_wait_for_runtime_change` waits with exact type/Event filters, bounded timeouts, monotonic sequences, and explicit `found`, `timeout`, and retained-window `gap` outcomes.
- Mechanical candidate evidence for duplicate live Fibers, equivalent registrations, orphaned owners, trace `next()` anomalies, and instrumentation conflicts; candidates never claim a root cause or remediation.
- `dsh-cordis-debug` JSON CLI for target listing, snapshots, focused Event/Fiber inspection, bounded waits, checkpoint persistence/comparison, and finite profiling requests.
- One shared **WaterfallExperimentCoordinator** that owns all instrumentation mutation across Human UI, DSH Agent tools, and external MCP experiment tools.
- Finite Agent leases with exact ownership, TTL cleanup, stale-stop protection, Human emergency stop, and experiment-tagged traces.
- DSH start/stop experiment tools where start requires one-shot `ctx.approval` and stop performs exact-lease cleanup without a second approval.
- Optional authenticated MCP experiment capability; mutation tools are omitted by default and require an explicit non-empty bearer token.
- Package-local `dsh-cordis-devtools-mcp` stdio bridge, profile-scoped bootstrap/doctor/token rotation, and owner-only `mcp.tokenFile` handling; the bridge keeps credentials outside Agent context and forwards the existing MCP surface without auto-replaying calls.
- Real DSH E2E proving DSH approval, authenticated MCP, exact `experimentId` trace retrieval, stale-stop safety, TTL cleanup, Human emergency stop, and ordinary Human profiling in the same shipped composition.
- Loopback-only Host → browser diagnostics/control through DSH Connection RPC.
- DSH-native control chrome through `@deepseek-ai/dsh-client-ui-primitives`.

## Runtime modes and ownership

### Observer mode — default

Installing the plugin, opening Cordis DevTools, polling Events/Timeline/Fibers, using read-only Agent diagnostics/verification, querying experiment status, or opening the Profiler view does **not** enable instrumentation.

Observer mode:

- never wraps or replaces target listener callbacks;
- never replaces Cordis waterfall `next()`;
- records metadata rather than arbitrary event payloads;
- keeps dispatch history bounded;
- treats historical Fiber references as historical rather than promoting them into live inventory.

`internal/dispatch` fires before public listeners execute, so the observer Timeline intentionally does **not** claim generic completion, executed-listener identity, per-listener duration, waterfall `next()` behavior, or chain-stop attribution.

### Instrumented waterfall mode — explicit, owned, finite for Agents

Waterfall instrumentation is still opt-in and still targets **waterfall only**. Non-waterfall modes delegate to the original Cordis dispatch implementation.

The Host-side `WaterfallExperimentCoordinator` is the only production owner of low-level instrumentation mutation:

```text
Human Profiler ───────┐
DSH Agent tools ──────┼─→ WaterfallExperimentCoordinator ─→ WaterfallInstrumentationController
External MCP tools ───┘
```

Ownership is factual and single-slot:

- Human profiling acquires Human ownership and remains explicitly enabled until the Human disables it.
- DSH/MCP Agent starts create finite leases with opaque `leaseId`, source, start time, and expiry.
- A second owner cannot steal active instrumentation; the start returns the current busy/owner fact instead of mutating it.
- Agent stop requires the exact active `leaseId`; stale ids are no-ops.
- Agent TTL expiry disables only the same still-active lease.
- Human emergency stop may terminate an Agent lease at any time.
- `conflict` / `unsupported` remain fail-closed and never overwrite a dispatch patch the controller no longer owns.

The adapter does not mutate `_hooks[].callback` and does not replace Cordis' native `waterfall()` continuation engine. Each dispatch gets dispatch-local listener wrappers and traced `next()` delegation. Cleanup restores only the DevTools-owned patch.

Instrumentation records only profiling metadata: event identity, listener registration/owner/order, timing, outcome category, `next()` call facts, and optional Agent `experimentId`. It does **not** retain raw listener arguments, return values, error objects/messages, prompts, tool results, file contents, config, bearer tokens, or credentials.

Instrumented mode is intentionally not described as zero-side-effect observation. Promise settlement timing uses side observation while returning the original Promise/thenable identity to the caller; this can affect host-level handled/unhandled bookkeeping. The default observer path does not install that behavior.

## Product architecture and routes

```text
                              Cordis runtime
                                   │
                  ┌────────────────┴─────────────────┐
                  │                                  │
           observer collection             waterfall instrumentation
                  │                                  │
                  ▼                                  ▼
          ObserverCollector       WaterfallInstrumentationController
                  │                                  ▲
                  │                       only mutated through
                  │                                  │
                  └───────────────┐   WaterfallExperimentCoordinator
                                  │        ▲        ▲        ▲
                                  ▼        │        │        │
                           DevtoolsService │        │        │
                                  │       Human     DSH      MCP
                         ┌────────┴─────────┐
                         ▼                  ▼
              AgentDebugService       RuntimeDiagnosticsQuery
              target/session/        focused facts + verification
              snapshot/wait                    │
                   │                            ▼
        ┌──────────┼──────────┐          DSH CordisRuntime
        ▼          ▼          ▼          Inspect Provider
       MCP        CLI       Skill              │
   Streamable HTTP  JSON   workflow             ▼
       │          │          │             DSH in-process Agent
       └──────────┴──────────┘
          external coding Agents

                    browser RPC / profiler RPC → Cordis DevTools Web
```

Direct listener-registry / live-Fiber implementation access remains isolated behind `src/host/cordis-adapter.ts`. Low-level waterfall compatibility logic lives in `src/host/instrumentation/waterfall-controller.ts`; ownership/TTL policy lives in `waterfall-experiment-coordinator.ts`; observer collection does not depend on either.

`RuntimeDiagnosticsQuery` and Runtime Verification do not create a second runtime model. They perform targeted reads and canonical projections over the same observer/profiler facts owned by `DevtoolsService`, so DSH Inspect and MCP share evidence semantics instead of implementing their own runtime traversal or diff algorithms.

`AgentDebugService` is transport-neutral. MCP and the CLI call the same target/session/snapshot/wait semantics; focused diagnostics, checkpoints, and the shared experiment coordinator remain the same Host-owned facts. This is intentionally an Agent product layer, not a general-purpose DSH control plane.

There is no raw CDP-compatible WebSocket endpoint in v0.8. A CDP-like wire protocol is deferred until a concrete IDE or dedicated debugger needs it; current Agent access is through the local stdio bridge, manual HTTP MCP, the CLI, and the Skill workflow.

See [the v0.8 architecture document](docs/architecture.md), [Agent Runtime Diagnostics guide](docs/agent-runtime-diagnostics.md), [v0.5 Runtime Verification design](docs/v0.5-runtime-verification.md), [v0.6 Controlled Runtime Experiments](docs/v0.6-controlled-runtime-experiments.md), the [v0.8 Agent Bridge decision](.agents/notes/implemented/architecture/2026-08-26-agent-bridge-bootstrap.md), and the historical [v0.7 Agent Debug decision](.agents/notes/implemented/architecture/2026-08-25-dsh-devtools-for-agents.md) for detailed invariants.

## Web Cordis DevTools

### Events

The Events view lists current event registrations and exposes event name, live listener count, listener execution order/runtime-local id, owner Fiber name/uid/lifecycle state, `prepend` / `global`, and event-name search. A listener owner can navigate to the corresponding Fiber only when that uid still exists in the authoritative live registry.

### Timeline

The Timeline renders the bounded observer dispatch window newest-first. Rows expose only observer-supported facts: timestamp, invocation mode, event name, argument count, registered-listener count, runtime-local dispatch id, and known dispatch-context Fiber metadata.

It is a **recent bounded window, not a complete or lossless audit log**. Older records can be overwritten between browser polls.

### Fibers

The Fibers view uses `ctx.registry` as the authoritative live plugin-Fiber inventory. It supports name/uid search and lifecycle-state filtering and shows selected-Fiber metadata including parent, declared inject service names, owned current events/listeners, recent bounded dispatch-context hits, and labeled live Effects.

Effects come directly from `fiber.getEffects()` and preserve only `label + children`. Raw effect disposer/function references, stacks, config, or arguments are not transported.

### Profiler

Opening the Profiler performs a read-only snapshot. It does **not** enable instrumentation. A trace can expose event/outcome, elapsed timing facts, ordered listener spans/owners, entered/returned/settled facts, every observed `next()` call, and an optional exact Agent `experimentId`.

Human ownership presents the ordinary `Disable profiling` action. An Agent-owned lease is visibly identified by source/expiry and presents **Stop Agent experiment**, which invokes Human emergency-stop semantics rather than pretending the session is Human-owned.

Repeated or late `next()` is displayed as recorded behavior rather than normalized into a single continuation. The UI does not invent `selfTime` or a definitive `shortCircuit`/`veto` boolean from incomplete continuation evidence.

## Agent Debug workflow

The v0.7 Agent surface follows a Chrome DevTools-style workflow at the product level, while using MCP tools rather than exposing raw protocol frames:

```text
cordis_list_debug_targets
        ↓ targetId + targetEpoch
cordis_attach_debug_session
        ↓ debugSessionId
cordis_debug_snapshot ──→ focused evidence tools
        ↓                         │
cordis_wait_for_runtime_change    │
        ↓                         │
checkpoint → normal edit/reload → compareCurrent
        ↓
cordis_detach_debug_session
```

There is one active `cordis-runtime` target in v0.7. Each target incarnation has an opaque `targetId` and monotonic `targetEpoch`. Replacing or disposing the target makes earlier sessions stale; Agents must list and attach again instead of reusing ids, cursors, sequence numbers, checkpoints, or leases across incarnations.

An attached `debugSessionId` owns bounded catalog cursors and pending waits. Sessions are explicitly detachable, expire after an idle TTL, and release session-owned experiment leases and waiters when they end. Session state is lifecycle evidence, not a guarantee that the runtime has not changed between calls.

`cordis_debug_snapshot` is the cold-start exploration operation. It returns a metadata-only snapshot with optional `summary`, `events`, `fibers`, `dispatches`, `profiler`, and `candidates` sections. Event, Fiber, dispatch, and candidate catalogs are bounded and cursor-paged; each page carries `bounded`, `returned`, `total`, `truncated`, `cursor`, and `nextCursor` facts. The profiler section reports retained waterfall traces/status counts without enabling instrumentation.

`cordis_wait_for_runtime_change` waits for one exact metadata-only observation after an optional `afterSequence` barrier. Supported observation types are `dispatch-observed`, `topology-invalidated`, `profiler-trace-updated`, `profiler-status-changed`, and `target-disposed`. The result is one of `found`, factual `timeout`, or explicit retained-window `gap`; `gap: true` means the requested cursor is older than the bounded journal and must be recovered with a fresh snapshot. A timeout or empty bounded result never means that an event never happened.

The focused read-only Agent surface remains available:

- `cordis_runtime_summary`;
- `cordis_inspect_event`;
- `cordis_inspect_fiber`;
- `cordis_search_dispatches`;
- `cordis_profiler_traces` (optionally exact-filtered by `experimentId`);
- `cordis_capture_checkpoint`;
- `cordis_compare_current`;
- `cordis_waterfall_experiment_status` when the coordinator is exposed.

The five v0.7 session tools are also read-only: `cordis_list_debug_targets`, `cordis_attach_debug_session`, `cordis_debug_snapshot`, `cordis_wait_for_runtime_change`, and `cordis_detach_debug_session`. Snapshot candidates are mechanical evidence only; they never emit root-cause, `fixed`, remediation, or confidence claims.

### Runtime Verification workflow

A checkpoint is a versioned, self-contained JSON value returned to the caller. The Agent keeps it and later sends it back to `compareCurrent`:

```text
inspect runtime problem
        ↓
captureCheckpoint(scope?)
        ↓
edit / reload through the normal development workflow
        ↓
compareCurrent({ baseline })
        ↓
semantic Event / Listener / Fiber changes
```

Checkpoint scope supports exact event and Fiber names. It contains authoritative current Event / Listener / live-Fiber topology and metadata-only Effects; bounded dispatch history and profiler traces are deliberately excluded.

Cross-checkpoint comparison is semantic and multiplicity-based. Runtime-local listener ids, Fiber uids, owner uids, and listener registration order may be useful capture-local evidence but are not stable identity keys. Listener semantic groups use event + owner name + `prepend` + `global`; Fiber semantic groups use canonical current Fiber metadata. Duplicate equivalent instances therefore report facts such as `2 → 1` instead of arbitrary instance pairing.

`compareCurrent` reports mechanical facts only. It does not emit `fixed`, `rootCause`, or confidence fields.

## Controlled Agent waterfall experiments

### DSH Agent path

`CordisRuntime` remains read-only. v0.6 registers two separate DSH tools:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

Start requests one-shot DSH approval before coordinator mutation. Only `allowed-once` proceeds; missing Agent/approval, rejection, cancellation, or unavailable answerer fail closed. The returned lease is finite (default 15 s, maximum 60 s). Stop needs no second approval because it can only end the exact active lease.

A normal workflow is:

```text
cordis_start_waterfall_experiment({ ttlMs })
        ↓
leaseId
        ↓
reproduce one waterfall behavior
        ↓
profilerTraces({ experimentId: leaseId })
        ↓
cordis_stop_waterfall_experiment({ leaseId })
```

### External Agent path — MCP

MCP stays disabled by default. When enabled, the endpoint is Streamable HTTP on loopback and exposes the seven focused read-only tools plus the five v0.7 Agent Debug session tools:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

That exposes the MCP endpoint at `http://127.0.0.1:43127/mcp`.

The seven focused read-only tools are:

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
cordis_capture_checkpoint
cordis_compare_current
```

The v0.7 Agent Debug tools are:

```text
cordis_list_debug_targets
cordis_attach_debug_session
cordis_debug_snapshot
cordis_wait_for_runtime_change
cordis_detach_debug_session
```

The session tools are read-only, but attach/detach establish lifecycle state and snapshot/wait use bounded Host resources. Keep the returned target/session ids and detach when the debugging task ends.

To grant external controlled-experiment authority, explicitly configure both a bearer token and the experiment capability:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      token: ${CORDIS_DEVTOOLS_MCP_TOKEN}
      experiments:
        enabled: true
```

When a token is configured, every MCP request must authenticate with `Authorization: Bearer ...`. The endpoint remains bound to `127.0.0.1`. The token is never copied into tool arguments, diagnostic output, traces, checkpoints, or logs.

With experiment capability enabled, MCP additionally exposes:

```text
cordis_waterfall_experiment_status   # read-only
cordis_start_waterfall_experiment    # mutation, finite lease
cordis_stop_waterfall_experiment     # exact-lease cleanup
```

When a debug session owns the experiment, include its exact `debugSessionId` in start/stop calls; the Host then releases the lease when that session detaches, expires, or becomes stale. Without a session id, the legacy MCP experiment path remains available under the same coordinator, token, capability, exact-lease, TTL, and Human emergency-stop rules.

`cordis_profiler_traces` accepts an exact `experimentId`, so an external Agent can retrieve its own retained trace subset without timestamp inference. Retention remains bounded; exact filtering does not turn the trace store into a lossless experiment log.

A listener bind failure is contained to the optional MCP adapter by default; `failOnStartupError: true` makes MCP availability required for plugin activation.

### Local Agent bridge

For Agent hosts that support stdio MCP servers, use the package-local
`dsh-cordis-devtools-mcp` bin. An explicitly authorized setup prepares one DSH
profile's MCP patch and owner-only token file; it does not restart DSH or print
the token:

```bash
dsh-cordis-debug setup --profile web --agent codex
```

`setup --agent codex` creates the owner-only token file, updates the selected
profile, and registers the local bridge with Codex itself. It does not restart
DSH or print the token. Reload DSH normally after setup:

```text
codex mcp add dsh-cordis-devtools -- dsh-cordis-devtools-mcp --endpoint http://127.0.0.1:43127/mcp --token-file <profile-token-file>
```

The command above is the registration shape used by setup; `<profile-token-file>`
is a local path, not a token value. If setup cannot invoke Codex, run that
shape manually with the absolute token-file path reported by the local profile.

Use `dsh-cordis-debug doctor --profile web` to verify profile state,
token-file permissions, endpoint authentication, and tool discovery. The
bridge keeps the token out of prompts, tool arguments, logs, and diagnostic
results. This repository's local/package bin is the supported path here; do
not assume an `npx` release is published.

After `dsh-cordis-debug rotate-token --profile web`, reload DSH through its
normal user-controlled workflow. An already-running bridge may have an old
remote connection: if its first tool request fails after that reload, the
Agent/user may explicitly retry that same request once, which lets the bridge
reconnect and reread the token file. The bridge never automatically retries or
replays a tool call; report a second failure instead of issuing more retries.

The manual authenticated HTTP MCP route below remains supported for hosts that
cannot launch a stdio server.

### JSON CLI

The package exposes `dsh-cordis-debug`, a one-shot JSON CLI built on the same MCP tools. It requires a loopback MCP endpoint and a bearer token, supplied either as global flags or environment variables:

```bash
export DSH_CORDIS_DEBUG_ENDPOINT=http://127.0.0.1:43127/mcp
export DSH_CORDIS_DEBUG_TOKEN="$CORDIS_DEVTOOLS_MCP_TOKEN"
dsh-cordis-debug targets
```

Equivalent flags are `--endpoint URL` / `--endpoint=URL` and `--token VALUE` / `--token=VALUE`. The CLI accepts only `http`/`https` loopback endpoints (`localhost`, `127.0.0.1`, or `[::1]`) and emits one JSON value or one structured JSON error per invocation.

Available commands:

```text
dsh-cordis-debug targets
dsh-cordis-debug snapshot
dsh-cordis-debug event EVENT_NAME
dsh-cordis-debug fiber --uid UID | --name FIBER_NAME
dsh-cordis-debug watch [--event EVENT_NAME] [--timeout MS]
dsh-cordis-debug checkpoint [--output FILE]
dsh-cordis-debug compare --baseline FILE
dsh-cordis-debug profile --ttl MS
```

`snapshot`, `watch`, and `profile` create a transient debug session and always attempt to detach it. `checkpoint --output` is the only CLI command that writes a file; `compare` reads a caller-owned JSON checkpoint. `profile` starts a finite lease and immediately performs exact-lease cleanup in the same one-shot invocation; it does not accept a reproduction callback or execute arbitrary runtime actions.

### User Skill

The installable [skills/dsh-runtime-debugging/SKILL.md](skills/dsh-runtime-debugging/SKILL.md) teaches an MCP-capable coding Agent how to use target/session discovery, bounded snapshots, focused evidence, checkpoints, waits, and approved profiling. It is observational and verification-oriented. It does not authorize arbitrary dispatch, reload, breakpoints, evaluation, generic runtime mutation, or payload capture. Agents should preserve target/session/lease ids, recover from `gap` with a fresh snapshot, and detach sessions when finished.

The Skill assumes that the Agent host has already configured the stdio bridge
or the manual loopback MCP endpoint. See [Connecting an MCP-capable Agent](docs/agent-runtime-diagnostics.md#connecting-an-mcp-capable-agent) for Codex registration, token handling, and connection verification.

## Refresh and retention semantics

The observer and profiler client stores are intentionally separate:

- opening the panel starts one observer snapshot poller;
- switching among Events/Timeline/Fibers does not create another observer poller;
- the profiler poller exists only while the Profiler tab is active;
- opening Profiler performs only a read;
- requests do not intentionally overlap;
- closing/switching away aborts the relevant profiler request and stops its timer;
- failed refreshes preserve the last successful snapshot and mark it stale;
- explicit profiler mutation can abort a background profiler read so the user action is not lost.

Host observer dispatch retention and profiler trace retention are independently bounded. Agent dispatch/trace queries expose `bounded`, `retained`, `matched`, `returned`, and `truncated` metadata instead of upgrading retained evidence into a complete-history claim.

## Project structure

```text
src/
├─ host/
│  ├─ collector.ts                         # behavior-neutral observer core
│  ├─ cordis-adapter.ts                    # listener/live-fiber compatibility seam
│  ├─ diagnostics.ts                       # transport-neutral targeted + verification queries
│  ├─ verification/
│  │  ├─ checkpoint.ts                     # canonical caller-owned checkpoint projection
│  │  └─ diff.ts                           # semantic multiplicity-preserving comparison
│  ├─ cordis-inspect.ts                    # DSH CordisRuntime Provider adapter
│  ├─ dsh-experiments.ts                   # DSH approval-gated start/stop tools
│  ├─ agent-debug/                         # target/session/snapshot/wait Agent core
│  ├─ runtime-notifications.ts             # bounded metadata-only notification source
│  ├─ mcp-experiment-control.ts            # thin MCP → shared coordinator adapter
│  ├─ mcp.ts                               # embedded loopback MCP adapter + auth/capability
│  ├─ service.ts                           # observer/profiler/coordinator composition
│  ├─ rpc.ts                               # loopback Connection RPC adapter
│  ├─ ring-buffer.ts                       # bounded observer dispatch history
│  ├─ trace-store.ts                       # bounded/upserted profiler traces
│  └─ instrumentation/
│     ├─ waterfall-controller.ts           # low-level explicit waterfall seam
│     └─ waterfall-experiment-coordinator.ts # single owner + finite Agent leases
├─ shared/
│  ├─ agent-debug.ts                       # v0.7 target/session/snapshot/wait contracts
│  ├─ diagnostics.ts                       # machine-facing diagnostics contracts
│  ├─ experiments.ts                       # transport-neutral experiment contract
│  ├─ verification.ts                      # checkpoint/diff contracts
│  ├─ rpc.ts                               # observer/profiler endpoint constants
│  ├─ types.ts                             # observer snapshot contracts
│  └─ trace.ts                             # waterfall trace/status contracts
├─ client/
│  ├─ DevtoolsShell.tsx
│  ├─ port.ts / store.ts
│  ├─ profiler-port.ts / profiler-store.ts
│  └─ views/
│     ├─ EventsView.tsx
│     ├─ TimelineView.tsx
│     ├─ FibersView.tsx
│     └─ ProfilerView.tsx
├─ cli.ts / cli-entry.ts                   # MCP-backed JSON CLI connection entry
├─ cli/program.ts                           # CLI command parser and tool workflows
└─ index.ts                                # DSH / Cordis Host plugin entry

skills/
└─ dsh-runtime-debugging/SKILL.md          # installable end-user Agent workflow
```

## Milestones

### v0.1 — Observer core ✓

Live listener/Fiber observation and bounded dispatch snapshots.

### v0.2 — Web observer DevTools ✓

Events / Timeline / Fibers, cross-navigation, Effects Inspector, and real DSH Web smoke.

### v0.3 — Opt-in waterfall Profiler ✓

Reversible/fail-closed waterfall instrumentation, parity harness, bounded trace store, Profiler UI, and real DSH profiling E2E.

### v0.4 — Agent Runtime Diagnostics ✓ repository-ready

DSH `CordisRuntime`, loopback MCP, five targeted machine-facing queries, and real duplicate-Fiber Agent debugging proof.

### v0.5 — Runtime Verification ✓ repository-ready

Caller-owned checkpoints, semantic multiplicity-preserving diff, DSH/MCP parity, and real DSH duplicate topology `2 → 1` verification.

### v0.6 — Controlled Runtime Experiments ✓ repository-ready

- one coordinator owns every waterfall instrumentation mutation route;
- Human vs Agent ownership is explicit and visible;
- DSH/MCP Agent leases are finite, exact-owner checked, TTL-cleaned, and trace-tagged;
- DSH start requires one-shot `ctx.approval`; denied/unavailable paths fail closed before mutation;
- external MCP experiment mutation is hidden by default and requires explicit capability + bearer token;
- Human emergency stop always remains available;
- MCP `profilerTraces` supports exact `experimentId` filtering;
- real DSH E2E proves DSH approval, MCP auth, stale-stop safety, TTL cleanup, Human emergency stop, and Human profiler recovery without model/API credentials.

Detailed v0.6 evidence is in [the v0.6 roadmap](docs/v0.6-roadmap.md).

### v0.7 — DSH DevTools for Agents ✓ repository-ready

- MCP remains the primary Agent integration and keeps the seven focused read-only tools;
- target discovery, target epochs, bounded attach/detach sessions, idle expiry, and stale-target lifecycle facts;
- metadata-only cold-start snapshots with bounded cursor-paged catalogs and mechanical evidence candidates;
- bounded sequence-aware runtime waits with exact filters and explicit `found` / `timeout` / `gap` outcomes;
- a loopback/token-authenticated `dsh-cordis-debug` JSON CLI and installable runtime-debugging Skill;
- session-owned experiment cleanup while preserving the v0.6 approval, capability, exact-lease, TTL, and Human emergency-stop rules.

Automatic reload/orchestration, arbitrary event execution, generic listener/service/config mutation, persistent approvals, lease renewal, concurrent leases, remote/LAN MCP, raw payload capture, `diagnose()` verdicts, breakpoints, pause/step, expression evaluation, and non-waterfall instrumentation remain outside v0.7. A raw WebSocket/CDP-compatible wire endpoint is also deferred; MCP, CLI, and Skill are the supported Agent routes.

## Install into a DSH Web profile

```bash
pnpm install
pnpm build
dsh plugin --profile web add ./
```

Open **Cordis DevTools** from the DSH Web sidebar footer. Diagnostics/control RPC uses loopback authority. DSH read access uses Cordis Inspect; DSH experiment start uses the normal approval service; external Agent access uses the MCP endpoint and token configuration above. The CLI and Skill consume that same MCP surface.

## Development

```bash
pnpm install
pnpm verify:policy
pnpm typecheck
pnpm test
pnpm build
pnpm verify:client-bundle
pnpm test:e2e:web
```

CI runs the unit/contract coverage for Agent Debug target/session lifecycle, snapshot projection, bounded notifications and waits, MCP tools, CLI workflows, and the existing real DSH Web smokes. The v0.6 smoke uses a real shipped `SessionStore` session and real ToolRuntime/ApprovalService path, then an official external MCP Client and Human Profiler in the same disposable DSH composition. No model or API key is required.

E2E fixtures are not part of published package files or production plugin runtime. The waterfall overhead harness remains regression evidence rather than a fixed hosted-runner percentage budget.

## Agent-native workflow

For end-user runtime debugging, start with [skills/dsh-runtime-debugging/SKILL.md](skills/dsh-runtime-debugging/SKILL.md). Standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [.agents/notes/](.agents/notes/README.md); [development-loop](.agents/skills/development-loop/SKILL.md) defines the default development SOP; and the responsibility split is documented in [the development workflow](docs/development-workflow.md).

## Important semantics

- Invocation mode is a dispatch-level fact, not static event metadata.
- Observer `registeredListeners` is the raw registered count, not proof that every listener executed after context filtering.
- `DevtoolsSnapshot.fibers` and Effects are live inventory; historical dispatch Fiber references can outlive the Fiber.
- Empty Agent dispatch results mean “not observed in the retained bounded window,” not “never happened.”
- `truncated: true` means a query limit omitted retained matches; `bounded: true` separately means older runtime history may already have been overwritten.
- Target ids are opaque and target epochs identify runtime incarnations; a stale or disposed session must not be reused after reload/disposal.
- Agent Debug catalogs and observation journals are bounded; a `gap` result means the requested sequence fell out of the retained journal and requires a fresh snapshot.
- Snapshot candidates are mechanical evidence groups only; duplicate Fibers, equivalent registrations, orphaned owners, trace anomalies, and conflicts are not root-cause diagnoses.
- Runtime Verification checkpoints contain authoritative current topology, not bounded dispatch/profiler history.
- Checkpoints are caller-owned serializable values; the Host does not persist checkpoint ids/history.
- Runtime-local listener ids, listener order, Fiber/owner uids, timestamps, and checkpoint digests are evidence/integrity fields, not automatic cross-checkpoint object identity.
- Semantic comparison reports mechanical topology facts and multiplicities; it does not claim root cause or success.
- Read-only diagnostics, verification, and experiment status never enable instrumentation.
- Agent experiment start is a mutation and therefore goes through the v0.6 authority boundary: DSH one-shot approval or explicitly authenticated MCP capability. A v0.7 debug session may own the lease and receives exact-session cleanup.
- An Agent lease is finite; a stale `leaseId` cannot stop another owner, while Human emergency stop can always reduce instrumentation.
- `experimentId` identifies trace attribution, not completeness; profiler retention remains bounded.
- Instrumented mode targets the validated Cordis 4.0.1 compatibility behavior and fails closed when its seam is unavailable or no longer owned.
- Raw event arguments, return values, error details, prompts, tool results, plugin config, file contents, credentials, bearer tokens, and raw effect functions/disposers are not collected by current contracts.
- Loopback-only MCP is not a confidentiality boundary against untrusted local software; external mutation therefore requires authentication even on `127.0.0.1`.
- The supported Agent routes are MCP, the JSON CLI, and the installable Skill. Raw WebSocket/CDP wire compatibility, breakpoints, pause/step, evaluation, reload, arbitrary dispatch, and generic runtime mutation are not part of the current contract.

## License

Apache-2.0
