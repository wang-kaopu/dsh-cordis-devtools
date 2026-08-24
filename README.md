# dsh-cordis-devtools

Runtime diagnostics, before/after verification, and controlled waterfall experiments for DeepSeek Harness / Cordis — usable by developers, in-process DSH agents, and external MCP clients.

> Current repository version: **0.6.0**. Diagnostics and Runtime Verification remain read-only; v0.6 additionally lets Agents request one finite, authority-gated waterfall profiling experiment through the shared Host coordinator.
>
> Repository version readiness does **not** imply that an npm package, Git tag, or GitHub Release has been published.

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
- One shared **WaterfallExperimentCoordinator** that owns all instrumentation mutation across Human UI, DSH Agent tools, and external MCP experiment tools.
- Finite Agent leases with exact ownership, TTL cleanup, stale-stop protection, Human emergency stop, and experiment-tagged traces.
- DSH start/stop experiment tools where start requires one-shot `ctx.approval` and stop performs exact-lease cleanup without a second approval.
- Optional authenticated MCP experiment capability; mutation tools are omitted by default and require an explicit non-empty bearer token.
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

## Architecture

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
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
          browser RPC / profiler RPC   RuntimeDiagnosticsQuery
                    │                   read-only facts/status
                    ▼                           │
             Cordis DevTools Web               ▼
       Events | Timeline | Fibers      Runtime Verification
                 | Profiler           checkpoint + semantic diff
                                               /          \
                                              ▼            ▼
                                      CordisRuntime       MCP
                                      Inspect Provider    127.0.0.1 only
                                              │            │
                                              ▼            ▼
                                          DSH Agent    External agents
```

Direct listener-registry / live-Fiber implementation access remains isolated behind `src/host/cordis-adapter.ts`. Low-level waterfall compatibility logic lives in `src/host/instrumentation/waterfall-controller.ts`; ownership/TTL policy lives in `waterfall-experiment-coordinator.ts`; observer collection does not depend on either.

`RuntimeDiagnosticsQuery` and Runtime Verification do not create a second runtime model. They perform targeted reads and canonical projections over the same observer/profiler facts owned by `DevtoolsService`, so DSH Inspect and MCP share evidence semantics instead of implementing their own runtime traversal or diff algorithms.

See [the architecture document](docs/architecture.md), [Agent Runtime Diagnostics guide](docs/agent-runtime-diagnostics.md), [v0.5 Runtime Verification design](docs/v0.5-runtime-verification.md), and [v0.6 Controlled Runtime Experiments](docs/v0.6-controlled-runtime-experiments.md) for detailed invariants.

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

## Agent Runtime Diagnostics and Verification

The read-only Agent surface exposes:

- `runtimeSummary`;
- `inspectEvent`;
- `inspectFiber`;
- `searchDispatches`;
- `profilerTraces` (optionally exact-filtered by `experimentId`);
- `captureCheckpoint`;
- `compareCurrent`;
- read-only waterfall experiment status.

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

MCP stays disabled by default. Read-only v0.5 compatibility remains available with the original configuration:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

That exposes the original seven read-only MCP tools at `http://127.0.0.1:43127/mcp`.

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

`cordis_profiler_traces` accepts an exact `experimentId`, so an external Agent can retrieve its own retained trace subset without timestamp inference. Retention remains bounded; exact filtering does not turn the trace store into a lossless experiment log.

A listener bind failure is contained to the optional MCP adapter by default; `failOnStartupError: true` makes MCP availability required for plugin activation.

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
└─ index.ts                                # DSH / Cordis Host plugin entry
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

Automatic reload/orchestration, arbitrary event execution, generic listener/service/config mutation, persistent approvals, lease renewal, concurrent leases, remote/LAN MCP, raw payload capture, `diagnose()` verdicts, and non-waterfall instrumentation remain outside v0.6.

## Install into a DSH Web profile

```bash
pnpm install
pnpm build
dsh plugin --profile web add ./
```

Open **Cordis DevTools** from the DSH Web sidebar footer. Diagnostics/control RPC uses loopback authority. DSH read access uses Cordis Inspect; DSH experiment start uses the normal approval service; external access requires explicitly enabling MCP as described above.

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

CI runs two real DSH Web smokes in Chromium: the v0.5 Runtime Verification regression and the v0.6 Controlled Runtime Experiments proof. The latter uses a real shipped `SessionStore` session and real ToolRuntime/ApprovalService path, then an official external MCP Client and Human Profiler in the same disposable DSH composition. No model or API key is required.

E2E fixtures are not part of published package files or production plugin runtime. The waterfall overhead harness remains regression evidence rather than a fixed hosted-runner percentage budget.

## Agent-native workflow

Standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [.agents/notes/](.agents/notes/README.md); [development-loop](.agents/skills/development-loop/SKILL.md) defines the default development SOP; and the responsibility split is documented in [the development workflow](docs/development-workflow.md).

## Important semantics

- Invocation mode is a dispatch-level fact, not static event metadata.
- Observer `registeredListeners` is the raw registered count, not proof that every listener executed after context filtering.
- `DevtoolsSnapshot.fibers` and Effects are live inventory; historical dispatch Fiber references can outlive the Fiber.
- Empty Agent dispatch results mean “not observed in the retained bounded window,” not “never happened.”
- `truncated: true` means a query limit omitted retained matches; `bounded: true` separately means older runtime history may already have been overwritten.
- Runtime Verification checkpoints contain authoritative current topology, not bounded dispatch/profiler history.
- Checkpoints are caller-owned serializable values; the Host does not persist checkpoint ids/history.
- Runtime-local listener ids, listener order, Fiber/owner uids, timestamps, and checkpoint digests are evidence/integrity fields, not automatic cross-checkpoint object identity.
- Semantic comparison reports mechanical topology facts and multiplicities; it does not claim root cause or success.
- Read-only diagnostics, verification, and experiment status never enable instrumentation.
- Agent experiment start is a mutation and therefore goes through the v0.6 authority boundary: DSH one-shot approval or explicitly authenticated MCP capability.
- An Agent lease is finite; a stale `leaseId` cannot stop another owner, while Human emergency stop can always reduce instrumentation.
- `experimentId` identifies trace attribution, not completeness; profiler retention remains bounded.
- Instrumented mode targets the validated Cordis 4.0.1 compatibility behavior and fails closed when its seam is unavailable or no longer owned.
- Raw event arguments, return values, error details, prompts, tool results, plugin config, file contents, credentials, bearer tokens, and raw effect functions/disposers are not collected by current contracts.
- Loopback-only MCP is not a confidentiality boundary against untrusted local software; external mutation therefore requires authentication even on `127.0.0.1`.

## License

Apache-2.0
