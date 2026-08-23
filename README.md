# dsh-cordis-devtools

Runtime inspector and event profiler for DeepSeek Harness / Cordis.

> Early development. The project is observer-first: inspect the runtime without wrapping target listeners or changing Cordis dispatch semantics.

## Current capabilities

- Live Event / Listener Registry backed by the real Cordis listener registry.
- Listener execution order, `prepend` / `global`, and owning fiber metadata.
- Authoritative live Fiber Registry backed by `ctx.registry`, with parent/inject metadata, readable lifecycle states, and labeled effect trees from `fiber.getEffects()`.
- Cross-view navigation between listener owners, dispatch contexts, Fibers, and owned Events.
- Bounded recent Dispatch Timeline with invocation mode and dispatch-context metadata.
- One Web DevTools surface in the DSH sidebar footer with `Events`, `Timeline`, and `Fibers` views.
- Event/fiber search, lifecycle-state filtering, and dispatch-mode filtering.
- Loopback-only Host → browser snapshot transport through DSH Connection RPC.
- DSH-native control chrome through `@deepseek-ai/dsh-client-ui-primitives`.

## Architecture

```text
Cordis runtime
  ├─ ctx.events._hooks ───────────────┐
  ├─ ctx.registry ────────────────────┤
  ├─ fiber.getEffects() ──────────────┤
  ├─ internal/dispatch ───────────────┤
  ├─ internal/plugin ─────────────────┤
  └─ internal/status ─────────────────┤
                                      ▼
                             ObserverCollector
                              ├─ event registry
                              ├─ listener snapshot
                              ├─ live fiber/effect registry
                              └─ bounded dispatch ring buffer
                                      │
                                      ▼
                           CordisDevtoolsService
                              ├─ snapshot()
                              ├─ clearDispatches()
                              └─ subscribe()
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
          future CLI/export                 /cordis-devtools/snapshot
                                                loopback-only RPC
                                                     │
                                                     ▼
                                           Cordis DevTools Web
                                       sidebar.footer.action
                                         ├─ Events
                                         ├─ Timeline
                                         └─ Fibers
```

Direct Cordis internal access is isolated behind `src/host/cordis-adapter.ts`. The Web client consumes only the serializable shared snapshot contract and never reaches into Host Cordis internals. See [the architecture document](docs/architecture.md) for the invariants and observer/instrumented-mode boundary.

## Web Cordis DevTools

The single sidebar surface contains three views.

### Events

The Events view lists live events and their listener registrations:

- event name and live listener count;
- listener execution order and runtime-local id;
- owner fiber name, uid, and normalized lifecycle state;
- `prepend` and `global` flags;
- event-name search.

A listener owner can open the corresponding live Fiber directly. If the owner reference no longer resolves to current live inventory, it remains readable metadata rather than being promoted into a synthetic live Fiber.

It intentionally does **not** infer a static event dispatch mode. `emit`, `parallel`, `serial`, `bail`, and `waterfall` are invocation-level facts and belong to concrete dispatch records.

### Timeline

The Timeline view renders the current bounded Host dispatch window newest-first. It supports event / dispatch-context fiber search and filters for modes actually present in the snapshot.

Each row can expose only facts available from `DispatchRecord`: timestamp, invocation mode, event name, registered-listener count, runtime-local dispatch id, argument count, and known dispatch-context fiber metadata. A dispatch context can open its Fiber only when that uid still exists in the authoritative live registry.

The Timeline is a **recent bounded view, not a complete or lossless audit log**. The Host ring buffer can overwrite older records between browser polls. Observer mode also does not know generic duration, completion outcome, executed-listener identity, per-listener timing, or waterfall short-circuit attribution.

### Fibers

The Fibers view lists the current live plugin fibers from the Cordis registry. It supports name/uid search and lifecycle-state filters, and shows selected-fiber metadata including parent, declared inject service names, owned live events, and labeled live effects.

Effects come directly from Cordis `fiber.getEffects()` and preserve only human-readable labels plus nested child structure. Nodes with children use DSH disclosure rows for on-demand expansion. Empty/unlabeled effect metadata stays absent rather than being reconstructed from listener or service registries.

Owned listener and event counts are derived from the current listener registry by matching owner uid. Owned event names can navigate back to the Events view. **Recent dispatch-context hits** are derived only from the current bounded Timeline window; they are not lifetime execution counts and do not imply the selected fiber owned every listener involved in those dispatches.

Raw plugin config, intercept values, raw effect disposer/function references, service graphs, stacks, errors, and mutation controls are intentionally not exposed by this version.

## DSH UI alignment

Web controls reuse DSH's shared `@deepseek-ai/dsh-client-ui-primitives` when the semantics match: buttons, inputs, pills, tooltips, disclosure rows, outside-dismiss behavior, and icons. DevTools-specific panel/grid/list geometry remains package-owned CSS composed from `--dsw-*` tokens.

The visual rule is to prefer DSH layer backgrounds, spacing, selection state, and shared primitives; separators and high-contrast borders are added only when necessary for comprehension.

`@deepseek-ai/dsh-client-ui-primitives` stays external in `lib/client.js`; DSH Web supplies the platform-module instance through `window.__ModuleLoader__`. The package does not bundle a second copy of the DSH control library.

## Refresh semantics

Opening the panel refreshes immediately and starts one one-second polling loop. Switching between Events, Timeline, and Fibers does not start another poller. Periodic refresh is silent, so the Refresh button does not animate every second. Polling stops when the panel closes, and an in-flight request is aborted. Failed refreshes keep the last successful snapshot visible but mark it stale.

## Project structure

```text
src/
├─ host/
│  ├─ collector.ts        # observer core
│  ├─ cordis-adapter.ts   # narrow boundary around Cordis diagnostics
│  ├─ rpc.ts              # loopback-only DSH Connection adapter
│  └─ ring-buffer.ts      # bounded dispatch history
├─ shared/
│  ├─ rpc.ts              # transport channel constants
│  └─ types.ts            # serializable snapshot contracts
├─ client/
│  ├─ DevtoolsShell.tsx   # shared panel/navigation/filter state
│  ├─ EventExplorer.tsx   # compatibility re-export
│  ├─ views/
│  │  ├─ EventsView.tsx
│  │  ├─ TimelineView.tsx
│  │  └─ FibersView.tsx
│  ├─ DevtoolsPanel.module.css
│  ├─ port.ts             # Connection RPC snapshot adapter
│  ├─ store.ts            # visible-only refresh state
│  └─ index.ts            # DSH browser client plugin entry
└─ index.ts               # DSH / Cordis host plugin entry
```

## Planned milestones

### v0.1 — Observer core

- Live event/listener registry snapshots ✓
- Fiber ownership for listeners where Cordis exposes it ✓
- Bounded dispatch timeline data ✓
- Snapshot subscription API ✓

### v0.2 — Web DevTools

- Event explorer ✓
- Listener ordering view ✓
- Dispatch timeline ✓
- Fiber inspector ✓
- Cross-view navigation ✓
- Fiber Effects inspector ✓
- Real DSH Web smoke ✓

### v0.3 — Instrumented waterfall mode

- Per-listener timing
- `next()` tracking
- Short-circuit detection
- Self time vs downstream time

## Install into a DSH Web profile

Build the package first:

```bash
pnpm install
pnpm build
```

Then add the checkout to a Web profile:

```bash
dsh plugin --profile web add ./
```

The package declares both the Host bundle patch and a DSH `client` entry. In the Web UI, open **Cordis DevTools** from the sidebar footer. The diagnostics RPC channel is restricted to loopback authority.

## Development

```bash
pnpm install
pnpm verify:policy
pnpm typecheck
pnpm test
pnpm build
pnpm verify:client-bundle
```

`verify:client-bundle` executes the built `lib/client.js` handoff, verifies that it registers an executable `dsh-cordis-devtools` plugin through `window.__ModuleLoader__`, and proves the bundle requests DSH UI primitives from the shared module table rather than bundling its own copy.

## Agent-native workflow

This repository treats cold-start coding agents as first-class contributors. Short standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [Agent Notes](.agents/notes/README.md); and [development-loop](.agents/skills/development-loop/SKILL.md) defines the default maintainer-agent development SOP. The responsibility split and checkpoints are explained in [the development workflow](docs/development-workflow.md).

The process is intentionally smaller than DeepSeek Harness's full development system. New gates are added when this repository develops behavior or failure modes they can actually protect.

## Important semantics

`internal/dispatch` fires before Cordis resolves and executes the public event listeners. Observer mode therefore records dispatch occurrence and registered-listener metadata, **not** generic dispatch duration, completion outcome, or per-listener duration. Those measurements require explicit instrumentation and are intentionally deferred.

`DevtoolsSnapshot.fibers` is a live registry inventory. Its `effects` field is also live metadata and is not copied into historical dispatch records. Historical `DispatchRecord.thisFiber` references can outlive a fiber that has since been disposed; that difference is intentional.

Raw event arguments, prompts, tool results, plugin config, file contents, credentials, and raw effect functions/disposers are not collected by the current Web DevTools surface.

## License

Apache-2.0