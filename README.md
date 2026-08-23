# dsh-cordis-devtools

Runtime inspector and event profiler for DeepSeek Harness / Cordis.

> Early development. The project is observer-first: inspect the runtime without wrapping target listeners or changing Cordis dispatch semantics.

## Current capabilities

- Live Event / Listener Registry backed by the real Cordis listener registry.
- Listener execution order, `prepend` / `global`, and owning fiber metadata.
- Bounded dispatch observation on the Host.
- Web Event Explorer available from the DSH sidebar footer.
- Loopback-only Host → browser snapshot transport through DSH Connection RPC.

## Architecture

```text
Cordis runtime
  ├─ ctx.events._hooks ───────────────┐
  ├─ internal/dispatch ───────────────┤
  ├─ internal/plugin ─────────────────┤
  └─ internal/status ─────────────────┤
                                      ▼
                             ObserverCollector
                              ├─ event registry
                              ├─ listener snapshot
                              ├─ observed fibers
                              └─ dispatch ring buffer
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
                                             Web Event Explorer
                                        sidebar.footer.action
```

Direct Cordis internal access is isolated behind `src/host/cordis-adapter.ts`. The Web client consumes only the serializable shared snapshot contract and never reaches into Host Cordis internals. See [the architecture document](docs/architecture.md) for the invariants and observer/instrumented-mode boundary.

## Web Event Explorer

The first Web surface lists live events and lets you inspect their listener registrations:

- event name and live listener count;
- listener execution order and runtime-local id;
- owner fiber name, uid, and state;
- `prepend` and `global` flags;
- event-name search.

Opening the panel refreshes immediately and starts a one-second polling loop. Polling stops when the panel closes. Failed refreshes keep the last successful snapshot visible but clearly mark it stale.

The Event Explorer intentionally does **not** infer a static event dispatch mode. `emit`, `parallel`, `serial`, `bail`, and `waterfall` are invocation-level facts and remain attached to concrete dispatch records.

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
│  ├─ EventExplorer.tsx   # sidebar Event Explorer panel
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
- Dispatch timeline
- Fiber inspector

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

`verify:client-bundle` executes the built `lib/client.js` handoff and verifies that it registers an executable `dsh-cordis-devtools` plugin through `window.__ModuleLoader__`.

## Agent-native workflow

This repository treats cold-start coding agents as first-class contributors. Short standing orders live in [AGENTS.md](AGENTS.md); durable decisions and rejected alternatives live in [Agent Notes](.agents/notes/README.md); and [development-loop](.agents/skills/development-loop/SKILL.md) defines the default maintainer-agent development SOP. The responsibility split and checkpoints are explained in [the development workflow](docs/development-workflow.md).

The process is intentionally smaller than DeepSeek Harness's full development system. New gates are added when this repository develops behavior or failure modes they can actually protect.

## Important semantics

`internal/dispatch` fires before Cordis resolves and executes the public event listeners. Observer mode therefore records dispatch occurrence and registered-listener metadata, **not** generic dispatch duration or per-listener duration. Those measurements require explicit instrumentation and are intentionally deferred.

Raw event arguments, prompts, tool results, file contents, and credentials are not collected by the current Web Event Explorer.

## License

Apache-2.0
