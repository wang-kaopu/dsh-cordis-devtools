# Architecture

## Purpose

`dsh-cordis-devtools` exposes two deliberately separated diagnostic paths for the Cordis runtime used by DeepSeek Harness:

1. a **default observer path** that inspects facts Cordis already exposes without changing target dispatch behavior;
2. an **explicit opt-in waterfall instrumentation path** that measures listener/continuation execution only while the user has enabled profiling.

The separation is architectural. Observer facts and profiler facts have different sources, lifecycle costs, retention, and semantic guarantees, so they do not share one transport snapshot or one browser store.

## Runtime layers

```text
Cordis runtime
    │
    ├──────────────── Observer path ───────────────────────────────┐
    │                                                             │
    │  ctx.events._hooks / ctx.registry / fiber.getEffects()      │
    │  internal/dispatch / internal/plugin / internal/status      │
    │                         │                                   │
    │                         ▼                                   │
    │              src/host/cordis-adapter.ts                     │
    │                         │                                   │
    │                         ▼                                   │
    │                src/host/collector.ts                        │
    │               bounded observer state                        │
    │                                                             │
    └──────── Explicit waterfall instrumentation ─────────────┐    │
                                                              │    │
                src/host/instrumentation/                     │    │
                    waterfall-controller.ts                   │    │
                  instance-level dispatch seam                │    │
                              │                               │    │
                              ▼                               │    │
                    src/host/trace-store.ts                   │    │
                     bounded trace snapshots                  │    │
                              │                               │    │
                              └──────────────┬────────────────┘    │
                                             ▼                     ▼
                                      src/host/service.ts
                                       DevtoolsService
                                      /                \
                                     /                  \
                                    ▼                    ▼
                        observer snapshot RPC      profiler read/control RPC
                         /cordis-devtools           /cordis-devtools
                           snapshot                 profiler/snapshot
                                                   instrumentation/*
                              │                          │
                              ▼                          ▼
                    src/client/port.ts        src/client/profiler-port.ts
                    src/client/store.ts       src/client/profiler-store.ts
                              │                          │
                              └──────────┬───────────────┘
                                         ▼
                              src/client/DevtoolsShell.tsx
                              Events | Timeline | Fibers | Profiler
```

All Host RPC routes use DSH Connection with `loopback` authority.

## Observer compatibility boundary

`src/host/cordis-adapter.ts` is the narrow boundary for direct listener-registry and live-Fiber implementation details. Downstream observer code consumes project-owned snapshots instead of `_hooks` or numeric Fiber state directly.

The adapter owns:

- listener enumeration/order/owner metadata from the current Cordis hook registry;
- compact Fiber references;
- authoritative live Fiber inventory from `ctx.registry.values()` / runtime fibers;
- normalization of known numeric Fiber states;
- `fiber.getEffects()` projection to recursive `EffectSnapshot { label, children }` metadata only.

No raw disposer/function/config/arguments/stacks are copied from Effects.

## Observer collector

`ObserverCollector` listens to Cordis lifecycle/dispatch signals and owns only observer state.

`DispatchRecord` is intentionally a **pre-execution occurrence record**. It contains:

- runtime-local id;
- timestamp;
- invocation mode;
- event name;
- argument count;
- raw registered-listener count;
- known dispatch-context Fiber metadata.

It does not claim generic completion, executed-listener identity, listener duration, waterfall `next()` behavior, or chain-stop semantics.

The dispatch ring buffer is bounded. `internal/listener` invalidation is deferred because Cordis emits it before the Hook is stored; `internal/plugin` invalidation is deferred/coalesced so a disposing Fiber has left the live runtime list before a subscriber refreshes.

Observer mode never wraps target listener callbacks and never replaces Cordis `waterfall()` or its continuations.

## Waterfall instrumentation boundary

### Why instrumentation is separate

`internal/dispatch` fires before public listeners execute. Per-listener entry/timing, `next()` calls, async settlement, and repeated/late continuations therefore cannot be derived truthfully from observer metadata.

The approved v0.3 design installs instrumentation only after explicit user action.

### Seam

`WaterfallInstrumentationController` installs an **instance-level `ctx.events.dispatch` adapter** while enabled.

The design intentionally avoids:

- replacing `_hooks[].callback`, which would threaten unregister/disposer identity;
- replacing `EventsService.waterfall()`, whose native `cbs.shift()`/continuation behavior is precisely what must remain authoritative;
- calling original dispatch and then re-filtering Hooks, which would execute `Context.filter` twice.

For non-waterfall modes the adapter delegates to the saved original dispatch path.

For waterfall mode the compatibility branch mirrors the currently validated Cordis dispatch selection/filter/bind behavior and returns **dispatch-local wrapped callbacks**. `_hooks` remain untouched.

### Listener and continuation semantics

Each entered listener span records metadata around the real target callback. The wrapper is not `async`, so synchronous listeners are not Promise-normalized.

It preserves:

- synchronous return value identity/value;
- the same thrown error object;
- original Promise/thenable identity returned to Cordis/caller;
- original callback order and `this` binding;
- repeated `next()` behavior;
- late `next()` behavior;
- nested/reentrant waterfall as independent traces.

The last continuation argument is replaced only by a transparent traced delegate. Every observed call gets its own record and immediately delegates once to the original `next()`.

The trace contract therefore records continuation facts rather than publishing an irreversible `shortCircuit`/`veto` boolean. A listener can retain `next()` and call it after returning, so “no next observed at settlement time” is not necessarily a permanent chain-stop conclusion.

### Async settlement limitation

To observe Promise settlement timing while returning the original Promise/thenable object, instrumentation attaches side observation. This can affect host-level handled/unhandled bookkeeping even though the caller-visible Promise identity, value/reason, and propagation are preserved by the parity suite.

That trade-off exists only in explicitly enabled instrumented mode. The default observer path installs no such observation.

### Compatibility and fail-closed behavior

Enable checks the expected Cordis runtime seam before patching. Disable restores the previous instance descriptor/implementation only if DevTools still owns the installed wrapper.

If another component replaces `dispatch` while instrumentation is enabled, DevTools does not overwrite it during cleanup. The controller exposes `conflict` and fails closed.

Supported state is explicit:

- `disabled` — default, no DevTools dispatch patch;
- `enabled` — DevTools waterfall adapter currently owns the seam;
- `conflict` — another runtime patch owns the seam, so DevTools will not force recovery;
- `unsupported` — required compatibility assumptions are not available.

The current compatibility target is the validated Cordis 4.0.1 behavior. A later Cordis version is not considered supported merely because TypeScript still compiles; the behavior/parity matrix must pass first.

## Trace contract and storage

`src/shared/trace.ts` is the serializable instrumentation contract. It exposes only metadata needed for v0.3:

- `WaterfallDispatchTrace`: trace id, event, start/return/settle timing facts, outcome, ordered listener spans;
- `WaterfallListenerSpan`: listener id, owner reference, dispatch order, entered/return/settle facts, outcome, `nextCalls`;
- `WaterfallNextCall`: call index plus called/returned/settled facts and outcome;
- profiler instrumentation state.

It intentionally does **not** contain raw listener arguments, return values, error objects/messages, prompts, tool results, file contents, plugin config, credentials, `selfTime`, or definitive short-circuit/veto fields.

`WaterfallTraceStore` keeps a bounded set of serializable trace snapshots. Writes are upserts because a trace may gain additional settlement or late-continuation facts after the first snapshot is observed. Retention is bounded by `maxTraces`; the store is not a persistent database or lossless audit stream.

## Host service and transport separation

`DevtoolsService` composes:

- `ObserverCollector`;
- `WaterfallTraceStore`;
- `WaterfallInstrumentationController`.

The existing observer service surface remains available through `snapshot()`, `clearDispatches()`, and `subscribe()`.

Profiler reads/control are separate:

- `profiler/snapshot` returns `{ generatedAt, instrumentation, traces }`;
- `instrumentation/enable` explicitly enables the controller;
- `instrumentation/disable` explicitly disables it.

All live under the same `/cordis-devtools` Connection channel with loopback authority, but the observer snapshot never silently grows instrumented traces. That keeps normal one-second observer polling independent from profiler trace retention/transport.

Plugin disposal attempts to disable a DevTools-owned instrumentation patch. Conflict semantics remain fail-closed.

## Client state

### Observer store

`EventExplorerStore` owns one latest observer snapshot plus loading/stale/error state.

Opening the panel fetches immediately and starts one one-second observer poller. Events/Timeline/Fibers switching and cross-navigation are local UI state and do not create additional observer pollers. Periodic refresh is silent; closing/disposal aborts an in-flight request and stops the timer.

### Profiler store

`ProfilerStore` is independent. It activates only while the panel is open **and** the Profiler tab is selected.

Opening Profiler performs a read-only `profiler/snapshot`. It never calls enable automatically.

An explicit enable/disable mutation:

- can abort a background profiler read so the user action is not lost;
- uses the Host-returned profiler snapshot immediately;
- keeps button text stable while busy;
- preserves the previous successful snapshot and marks it stale on failure.

Switching away or closing the panel stops profiler polling and aborts the active profiler request.

## Web UI boundary

The shell contributes once to `sidebar.footer.action` and owns four views:

- **Events** — current listener registry;
- **Timeline** — bounded observer dispatch occurrence window;
- **Fibers** — authoritative live Fiber/effect inventory;
- **Profiler** — bounded opt-in waterfall execution traces.

Cross-navigation uses live inventory as the authority. Historical owner/context metadata stays readable but becomes non-navigable when its uid no longer exists in `DevtoolsSnapshot.fibers`.

Controls reuse `@deepseek-ai/dsh-client-ui-primitives` when semantics match: Button, Input, Pill, Tooltip, DisclosureRow, outside-dismiss behavior, and icons. Package-owned CSS handles DevTools information architecture using DSH tokens. Nonessential high-contrast borders/dividers are avoided.

## Core invariants

1. **Observer mode is behavior-neutral.** Installing/opening/polling never wraps target listeners or patches waterfall dispatch.
2. **Instrumentation is explicit.** Entering the Profiler is read-only; only the visible enable action installs the adapter.
3. **Unknown stays unknown.** Unsupported/incomplete facts are absent or shown as current observations rather than fabricated conclusions.
4. **Histories are bounded.** Observer dispatches and profiler traces have independent configured retention limits.
5. **Metadata-first privacy.** Raw event/listener payloads, return values, error details, prompts, tool results, plugin config, file contents, credentials, and raw effects do not cross the current contracts.
6. **Lifecycle ownership is explicit.** Observers, channels, timers, client pollers, and instrumentation cleanup are tied to owning plugin/UI lifecycles.
7. **Transport is not a second source of truth.** Host produces the snapshots; browser code validates and presents rather than reconstructing Cordis execution semantics.
8. **Live inventory stays live.** Historical Fiber references do not get promoted into authoritative current inventory.
9. **Instrumentation fails closed.** Unsupported/conflicting runtime seams are surfaced instead of silently patched or forcibly restored.
10. **Profiler timing stays factual.** v0.3 exposes entered/returned/settled and `next()` observations, not an undefined `selfTime` or irreversible chain-stop boolean.

## Testing layers

- Unit tests cover ring buffers, trace store, validators, and pure parity helpers.
- Real `@deepseek-ai/cordis` integration tests cover listener/Fiber/effect behavior, waterfall behavior matrix, instrumentation lifecycle, conflict handling, and bounded metadata-only traces.
- The I3 paired parity suite runs the same caller-visible scenarios with instrumentation absent vs enabled and compares return/error/order/`this`/side-effect facts.
- The I3 overhead harness records representative disabled/enabled samples as evidence without imposing a noisy hosted-runner percentage budget.
- Host RPC tests verify observer/profiler endpoint separation and loopback registration.
- jsdom/React integration tests use the real DSH UI primitive package and cover profiler read/toggle/navigation lifecycle.
- `verify:client-bundle` executes the built client handoff through `window.__ModuleLoader__`.
- Real DSH Web E2E installs the current checkout into a disposable profile. For v0.3 it also installs an E2E-only Cordis waterfall probe fixture so Chromium can deterministically verify `disabled → enable → real Host waterfall trace → expand/inspect → disable` without a model call or API key.

The E2E probe lives under `e2e/fixtures` and is not included by the package `files` list, so it is not part of the production plugin bundle/runtime.
