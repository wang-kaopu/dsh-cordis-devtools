# dsh-cordis-devtools

Runtime inspector and event profiler for DeepSeek Harness / Cordis.

> Early development. The first milestone focuses on observing Cordis fibers, listener registrations, and event dispatches without changing dispatch semantics.

## Goals

- Inspect which plugin fiber owns each Cordis listener.
- Observe event dispatches and build a bounded runtime timeline.
- Keep collection independent from presentation so a Web UI, CLI, or export format can consume the same snapshots.
- Stay observer-first: v0.1 does not wrap or replace listeners.

## Architecture

```text
Cordis runtime
  ├─ ctx.events._hooks ───────────────┐
  ├─ internal/dispatch ───────────────┤
  ├─ internal/plugin ─────────────────┤
  └─ internal/status ─────────────────┤
                                      ▼
                             ObserverCollector
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
                         ┌────────────┴────────────┐
                         ▼                         ▼
                   future Web UI             future exporters
```

The internal Cordis access is isolated behind `src/host/cordis-adapter.ts`. If Cordis changes its diagnostic internals, the rest of the project should not need to change.

## Project structure

```text
src/
├─ host/
│  ├─ collector.ts        # observer core
│  ├─ cordis-adapter.ts   # narrow boundary around Cordis diagnostics
│  └─ ring-buffer.ts      # bounded dispatch history
├─ shared/
│  └─ types.ts            # serializable snapshot contracts
├─ client/
│  └─ index.ts            # reserved Web client entry
└─ index.ts               # DSH / Cordis host plugin entry
```

## Planned milestones

### v0.1 — Observer core

- Live event/listener registry snapshots
- Fiber ownership for listeners where Cordis exposes it
- Dispatch timeline
- Bounded in-memory history
- Snapshot subscription API

### v0.2 — Web DevTools

- Event explorer
- Listener ordering view
- Dispatch timeline
- Fiber inspector

### v0.3 — Instrumented waterfall mode

- Per-listener timing
- `next()` tracking
- Short-circuit detection
- Self time vs downstream time

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Install a local checkout into a DSH profile after building:

```bash
dsh plugin --profile web add ./
```

The package declares a DSH bundle and inserts the host plugin through `cordis.patch.yml`.

## Important semantics

`internal/dispatch` fires before Cordis resolves and executes the public event listeners. v0.1 therefore records dispatch occurrence and registered-listener metadata, **not** generic dispatch duration or per-listener duration. Those measurements require explicit instrumentation and are intentionally deferred.

## License

Apache-2.0
