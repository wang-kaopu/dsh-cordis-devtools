# dsh-cordis-devtools

Runtime diagnostics and opt-in waterfall profiler for DeepSeek Harness / Cordis — usable by developers, in-process DSH agents, and external MCP clients.

> Current repository version: **0.4.0**. The default path remains observer-first and behavior-neutral; waterfall instrumentation is enabled only by an explicit DevTools action.
>
> Repository version readiness does **not** imply that an npm package or Git tag has been published.

## Current capabilities

- Live Event / Listener Registry backed by the real Cordis listener registry.
- Listener execution order, `prepend` / `global`, and owning Fiber metadata.
- Authoritative live Fiber Registry backed by `ctx.registry`, including parent/inject metadata and labeled effect trees from `fiber.getEffects()`.
- Cross-view navigation between listener owners, dispatch contexts, Fibers, and owned Events.
- Bounded observer Dispatch Timeline with invocation mode and dispatch-context metadata.
- Explicit opt-in **Waterfall Profiler** with entered listener spans, timing facts, outcome categories, repeated/late `next()` call records, and owner → Fiber navigation.
- Bounded profiler trace retention separated from the observer snapshot path.
- One DSH sidebar DevTools surface with `Events`, `Timeline`, `Fibers`, and `Profiler` views.
- Shared transport-neutral **Runtime Diagnostics Query** layer for targeted runtime summary, Event, Fiber, dispatch, and existing profiler-trace reads.
- DSH-native `CordisRuntime` Inspect Provider through the existing first-party `cordisInspect` registry.
- Optional embedded **MCP Streamable HTTP** endpoint for external coding agents, loopback-only and disabled by default.
- Loopback-only Host → browser diagnostics/control through DSH Connection RPC.
- DSH-native control chrome through `@deepseek-ai/dsh-client-ui-primitives`.

## Two runtime modes

### Observer mode — default

Installing the plugin, opening Cordis DevTools, polling Events/Timeline/Fibers, using the read-only Agent diagnostics, or opening the Profiler view does **not** enable instrumentation.

Observer mode:

- never wraps or replaces target listener callbacks;
- never replaces Cordis waterfall `next()`;
- records metadata rather than arbitrary event payloads;
- keeps dispatch history bounded;
- treats historical Fiber references as historical rather than promoting them into live inventory.

`internal/dispatch` fires before public listeners execute, so the observer Timeline intentionally does **not** claim generic completion, executed-listener identity, per-listener duration, waterfall `next()` behavior, or chain-stop attribution.

### Instrumented waterfall mode — explicit opt-in

The Profiler exposes `Enable profiling` / `Disable profiling`. Enabling installs an instance-level compatibility adapter around the current Cordis `events.dispatch` seam for **waterfall only**. Non-waterfall modes continue to delegate to the original Cordis dispatch implementation.

The adapter does not mutate `_hooks[].callback` and does not replace Cordis' native `waterfall()` continuation engine. Each dispatch gets dispatch-local listener wrappers and traced `next()` delegation. Disabling restores the DevTools-owned patch when it still owns the seam; if another runtime patch replaced it, DevTools reports `conflict` and fails closed instead of overwriting the other component.

Instrumentation records only metadata needed for profiling: event identity, listener registration/owner/order, timing, outcome category, and `next()` call facts. It does **not** retain raw listener arguments, return values, error objects/messages, prompts, tool results, file contents, config, or credentials.

Instrumented mode is intentionally not described as zero-side-effect observation. Promise settlement timing uses side observation while returning the original Promise/thenable identity to the caller; this can affect host-level handled/unhandled bookkeeping. The default observer path does not install that behavior.

## Architecture

```text
                         Cordis runtime
                              │
              ┌───────────────┴────────────────┐
              │                                │
       observer collection          explicit waterfall instrumentation
              │                                │
              ▼                                ▼
      ObserverCollector          WaterfallInstrumentationController
              │                                │
              └───────────────┬────────────────┘
                              ▼
                       DevtoolsService
                              │
             ┌────────────────┴────────────────┐
             │                                 │
             ▼                                 ▼
   browser RPC / profiler RPC        RuntimeDiagnosticsQuery
             │                         read-only facts
             ▼                         /          \
      Cordis DevTools Web             ▼            ▼
 Events | Timeline | Fibers     CordisRuntime     MCP
          | Profiler             Inspect Provider  127.0.0.1 only
                                      │            │
                                      ▼            ▼
                                  DSH Agent    External agents
```

Direct listener-registry / live-Fiber implementation access remains isolated behind `src/host/cordis-adapter.ts`. Waterfall instrumentation compatibility logic lives in `src/host/instrumentation/waterfall-controller.ts`; observer collection does not depend on it.

`RuntimeDiagnosticsQuery` does not create a second runtime model. It performs targeted reads over the same observer/profiler facts already owned by `DevtoolsService`, so DSH Inspect and MCP share evidence semantics instead of implementing their own runtime traversal.

See [the architecture document](docs/architecture.md) and [Agent Runtime Diagnostics guide](docs/agent-runtime-diagnostics.md) for detailed invariants and machine-facing semantics.

## Web Cordis DevTools

### Events

The Events view lists current event registrations and exposes:

- event name and live listener count;
- listener execution order and runtime-local id;
- owner Fiber name, uid, and lifecycle state;
- `prepend` / `global` flags;
- event-name search.

A listener owner can navigate to the corresponding Fiber only when that uid still exists in the authoritative live registry.

### Timeline

The Timeline renders the current bounded observer dispatch window newest-first. Rows expose only observer-supported facts: timestamp, invocation mode, event name, argument count, registered-listener count, runtime-local dispatch id, and known dispatch-context Fiber metadata.

It is a **recent bounded window, not a complete or lossless audit log**. Older records can be overwritten between browser polls.

### Fibers

The Fibers view uses `ctx.registry` as the authoritative live plugin-Fiber inventory. It supports name/uid search and lifecycle-state filtering and shows selected-Fiber metadata including parent, declared inject service names, owned current events/listeners, recent bounded dispatch-context hits, and labeled live Effects.

Effects come directly from `fiber.getEffects()` and preserve only `label + children`. Raw effect disposer/function references, stacks, config, or arguments are not transported.

### Profiler

The Profiler is a separate view and a separate read/control path from the observer Timeline.

Opening the tab performs a read-only profiler snapshot. It does **not** enable instrumentation. When explicitly enabled, the view shows bounded waterfall traces newest-first. A trace can expose:

- event and trace outcome;
- elapsed timing facts available from the current trace contract;
- ordered listener spans and owning Fiber references;
- listener entered/returned/settled facts;
- every observed `next()` call, including repeated or late calls.

Repeated or late `next()` is displayed as recorded behavior rather than normalized into a single continuation. The UI does not invent a `selfTime` metric and does not publish an irreversible `shortCircuit`/`veto` boolean from incomplete continuation evidence.

`conflict` and `unsupported` instrumentation states are visible and do not expose a misleading enable/disable action.

## Agent Runtime Diagnostics

The Agent-facing surface is deliberately read-only in v0.4. It exposes five logical queries over the live runtime:

- `runtimeSummary`;
- `inspectEvent`;
- `inspectFiber`;
- `searchDispatches`;
- `profilerTraces`.

### DSH Agent path

When the DSH composition provides the first-party `cordisInspect` registry, this plugin registers a Host provider named `CordisRuntime`. Existing DSH model tools discover and invoke it through the normal `cordis_inspect_list` / `cordis_inspect_query` path; the plugin does not register a duplicate model-tool family.

### External Agent path — MCP

MCP is disabled by default. Enable it explicitly in the plugin config:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

The endpoint is then available at:

```text
http://127.0.0.1:43127/mcp
```

The five MCP tools are:

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
```

All are marked read-only and idempotent. A listener bind failure is logged and contained to the optional MCP adapter by default; `failOnStartupError: true` makes MCP availability required for plugin activation. No v0.4 configuration can widen the bind beyond loopback.

See [Agent Runtime Diagnostics](docs/agent-runtime-diagnostics.md) for evidence semantics and example Agent flows.

## Refresh and retention semantics

The observer and profiler client stores are intentionally separate:

- opening the panel starts one observer snapshot poller;
- switching among Events/Timeline/Fibers does not create another observer poller;
- the profiler poller exists only while the Profiler tab is active;
- opening Profiler performs only a read; enable/disable requires an explicit click;
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
│  ├─ diagnostics.ts                       # transport-neutral targeted runtime queries
│  ├─ cordis-inspect.ts                    # DSH CordisRuntime Provider adapter
│  ├─ mcp.ts                               # embedded loopback MCP adapter
│  ├─ service.ts                           # observer + profiler composition
│  ├─ rpc.ts                               # loopback Connection RPC adapter
│  ├─ ring-buffer.ts                       # bounded observer dispatch history
│  ├─ trace-store.ts                       # bounded/upserted profiler traces
│  └─ instrumentation/
│     └─ waterfall-controller.ts           # explicit waterfall instrumentation seam
├─ shared/
│  ├─ diagnostics.ts                       # machine-facing diagnostics contracts
│  ├─ rpc.ts                               # observer/profiler endpoint constants
│  ├─ types.ts                             # observer snapshot contracts
│  └─ trace.ts                             # waterfall trace/status contracts
├─ client/
│  ├─ DevtoolsShell.tsx                    # four-view shell/navigation
│  ├─ port.ts / store.ts                   # observer transport/state
│  ├─ profiler-port.ts / profiler-store.ts # profiler transport/state
│  └─ views/
│     ├─ EventsView.tsx
│     ├─ TimelineView.tsx
│     ├─ FibersView.tsx
│     └─ ProfilerView.tsx
└─ index.ts                                # DSH / Cordis Host plugin entry
```

## Milestones

### v0.1 — Observer core ✓

- live event/listener registry snapshots;
- listener Fiber ownership;
- bounded dispatch timeline data;
- snapshot subscription API.

### v0.2 — Web observer DevTools ✓

- Events / Timeline / Fibers views;
- cross-view navigation;
- Fiber Effects Inspector;
- real DSH Web smoke;
- observer release-hardening invariants.

### v0.3 — Opt-in waterfall Profiler ✓

- approved explicit instrumentation architecture;
- serializable waterfall trace contract and real Cordis behavior matrix;
- default-disabled, reversible/fail-closed instrumentation core;
- paired instrumented-vs-baseline semantic parity harness;
- bounded profiler trace store and separate loopback transport;
- fourth Profiler view with explicit enable/disable control;
- real DSH Web integration exercising enable → real waterfall trace → inspect → disable.

### v0.4 — Agent Runtime Diagnostics ✓ repository-ready

- shared targeted Runtime Diagnostics Query layer;
- DSH-native `CordisRuntime` Inspect Provider;
- embedded loopback-only MCP Streamable HTTP endpoint;
- five read-only machine-facing runtime queries/tools;
- canonical DSH/MCP evidence semantics for live vs historical and bounded vs truncated facts;
- real DSH duplicate-Fiber proof through Cordis Inspect;
- official external MCP Client proof against the same running DSH process;
- one final real DSH smoke covering Cordis Inspect + external MCP + Human DevTools/Profiler together.

Profiler mutation tools, automatic root-cause `diagnose()`, remote/LAN MCP exposure, stdio bridge, automatic client configuration, multi-runtime discovery, persistent checkpoints/diffs, payload capture, and profiling of non-waterfall modes remain intentionally deferred beyond the first v0.4 slice.

Detailed v0.4 milestone evidence is in [the v0.4 roadmap](docs/v0.4-roadmap.md).

## Install into a DSH Web profile

Build the checkout first:

```bash
pnpm install
pnpm build
```

Then add it to a Web profile:

```bash
dsh plugin --profile web add ./
```

Open **Cordis DevTools** from the DSH Web sidebar footer. Diagnostics/control RPC is registered with loopback authority. DSH Agent access uses the existing Cordis Inspect infrastructure when present; external Agent access requires explicitly enabling MCP as shown above.

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

CI runs the real DSH Web smoke in Chromium against a disposable profile. The v0.4 smoke creates a deterministic duplicate-Fiber runtime shape, proves it through the real DSH `CordisRuntime` Inspect path, connects an official MCP Client from outside the running DSH process to prove the same evidence, and then continues the existing human UI + real waterfall Profiler assertions. E2E fixtures are not part of the published package files or production plugin runtime.

The existing waterfall overhead harness compares disabled and enabled representative samples as regression evidence. It intentionally does not impose a fixed percentage budget on hosted CI runners because those timings are noisy.

## Agent-native workflow

This repository treats cold-start coding agents as first-class contributors. Standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [.agents/notes/](.agents/notes/README.md); and [development-loop](.agents/skills/development-loop/SKILL.md) defines the default development SOP. The responsibility split is described in [the development workflow](docs/development-workflow.md).

## Important semantics

- Invocation mode is a dispatch-level fact, not static event metadata.
- Observer `registeredListeners` is the raw registered count, not proof that every listener executed after context filtering.
- `DevtoolsSnapshot.fibers` and Effects are live inventory; historical dispatch Fiber references can outlive the Fiber.
- Empty Agent dispatch results mean “not observed in the retained bounded window,” not “never happened.”
- `truncated: true` means a query limit omitted retained matches; `bounded: true` separately means older runtime history may already have been overwritten.
- Profiler traces are bounded snapshots that can be updated while late continuation facts arrive; they are not a lossless persistent trace database.
- Read-only Agent diagnostics do not enable profiler instrumentation.
- Instrumented mode currently targets the validated Cordis 4.0.1 compatibility behavior and fails closed when its required seam is unavailable or already owned by another runtime patch.
- Raw event arguments, return values, error details, prompts, tool results, plugin config, file contents, credentials, and raw effect functions/disposers are not collected by the current contracts.
- Loopback-only MCP is not a confidentiality boundary against untrusted software running on the same machine/account; broader access or authentication requires a separate design decision.

## License

Apache-2.0
