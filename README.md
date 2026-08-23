# dsh-cordis-devtools

Runtime inspector and event profiler for DeepSeek Harness / Cordis.

> Early development. The first milestone focuses on observing Cordis fibers, listener registrations, and event dispatches without changing dispatch semantics.

## Goals

- Inspect which plugin fiber owns each Cordis listener.
- Observe event dispatches and build a bounded runtime timeline.
- Keep collection independent from presentation so a Web UI, CLI, or export format can consume the same snapshots.
- Stay observer-first: v0.1 does not wrap or replace listeners.

## Planned milestones

### v0.1 — Observer core

- Fiber metadata snapshots
- Event/listener registry
- Dispatch timeline
- Bounded in-memory history

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

To install a local checkout into a DSH profile after building:

```bash
dsh plugin --profile web add ./
```

## Status

DeepSeek Harness is still evolving quickly. The observer core intentionally uses a narrow Cordis integration boundary so internal API changes can be isolated in one place.

## License

Apache-2.0
