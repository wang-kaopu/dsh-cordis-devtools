# dsh-cordis-devtools

Runtime inspector and opt-in waterfall profiler for DeepSeek Harness / Cordis.

> Current repository version: **0.3.0**. The default path remains observer-first and behavior-neutral; waterfall instrumentation is enabled only by an explicit DevTools action.
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
- Loopback-only Host → browser diagnostics/control through DSH Connection RPC.
- DSH-native control chrome through `@deepseek-ai/dsh-client-ui-primitives`.

## Two runtime modes

### Observer mode — default

Installing the plugin, opening Cordis DevTools, polling Events/Timeline/Fibers, or opening the Profiler view does **not** enable instrumentation.

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
  ├─ listener registry / ctx.registry / fiber.getEffects()
  ├─ internal lifecycle + dispatch signals
  │
  ├──────────── observer path ────────────────┐
  │                                           ▼
  │                                  ObserverCollector
  │                                     ├─ events/listeners
  │                                     ├─ live fibers/effects
  │                                     └─ bounded dispatches
  │
  └── explicit waterfall instrumentation ────┐
                                              ▼
                               WaterfallInstrumentationController
                                              │
                                              ▼
                                    WaterfallTraceStore
                                      bounded/upserted
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
               observer snapshot RPC                   profiler snapshot/control RPC
                  loopback-only                              loopback-only
                          │                                       │
                          ▼                                       ▼
                EventExplorerStore                         ProfilerStore
                panel-open polling                     profiler-tab-only polling
                          │                                       │
                          └───────────────────┬───────────────────┘
                                              ▼
                                      Cordis DevTools Web
                              Events | Timeline | Fibers | Profiler
```

Direct listener-registry / live-Fiber implementation access remains isolated behind `src/host/cordis-adapter.ts`. Waterfall instrumentation compatibility logic lives in `src/host/instrumentation/waterfall-controller.ts`; observer collection does not depend on it.

`DevtoolsService` composes the observer collector, bounded profiler trace store, and instrumentation controller while keeping their transport contracts separate. The existing observer `snapshot` endpoint does not grow profiler traces.

See [the architecture document](docs/architecture.md) for the detailed invariants and compatibility boundary.

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

Host observer dispatch retention and profiler trace retention are independently bounded. Neither path is a lossless audit stream.

## Project structure

```text
src/
├─ host/
│  ├─ collector.ts                         # behavior-neutral observer core
│  ├─ cordis-adapter.ts                    # listener/live-fiber compatibility seam
│  ├─ service.ts                           # observer + profiler composition
│  ├─ rpc.ts                               # loopback Connection RPC adapter
│  ├─ ring-buffer.ts                       # bounded observer dispatch history
│  ├─ trace-store.ts                       # bounded/upserted profiler traces
│  └─ instrumentation/
│     └─ waterfall-controller.ts           # explicit waterfall instrumentation seam
├─ shared/
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

### v0.3 — Opt-in waterfall Profiler ✓ repository-ready

- approved explicit instrumentation architecture;
- serializable waterfall trace contract and real Cordis behavior matrix;
- default-disabled, reversible/fail-closed instrumentation core;
- paired instrumented-vs-baseline semantic parity harness;
- bounded profiler trace store and separate loopback transport;
- fourth Profiler view with explicit enable/disable control;
- real DSH Web integration exercising enable → real waterfall trace → inspect → disable;
- release-hardening/privacy/retention documentation and tests.

`selfTime`, definitive chain-stop/short-circuit conclusions, payload capture, and profiling of `emit` / `parallel` / `serial` / `bail` remain intentionally outside v0.3.

Detailed milestone evidence is in [the roadmap](docs/roadmap.md).

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

Open **Cordis DevTools** from the DSH Web sidebar footer. Diagnostics/control RPC is registered with loopback authority.

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

CI also runs the real DSH Web smoke in Chromium against a disposable profile. The v0.3 smoke installs an E2E-only Cordis waterfall probe so the browser path can deterministically inspect a real Host trace without a model call or API key. The probe fixture is not part of the published package files or production plugin runtime.

The I3 overhead harness compares disabled and enabled representative waterfall samples as regression evidence. It intentionally does not impose a fixed percentage budget on hosted CI runners because those timings are noisy.

## Agent-native workflow

This repository treats cold-start coding agents as first-class contributors. Standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [.agents/notes/](.agents/notes/README.md); and [development-loop](.agents/skills/development-loop/SKILL.md) defines the default development SOP. The responsibility split is described in [the development workflow](docs/development-workflow.md).

## Important semantics

- Invocation mode is a dispatch-level fact, not static event metadata.
- Observer `registeredListeners` is the raw registered count, not proof that every listener executed after context filtering.
- `DevtoolsSnapshot.fibers` and Effects are live inventory; historical dispatch Fiber references can outlive the Fiber.
- Profiler traces are bounded snapshots that can be updated while late continuation facts arrive; they are not a lossless persistent trace database.
- Instrumented mode currently targets the validated Cordis 4.0.1 compatibility behavior and fails closed when its required seam is unavailable or already owned by another runtime patch.
- Raw event arguments, return values, error details, prompts, tool results, plugin config, file contents, credentials, and raw effect functions/disposers are not collected by the current contracts.

## License

Apache-2.0
