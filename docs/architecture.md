# Architecture

## Purpose

`dsh-cordis-devtools` exposes one Cordis runtime through three deliberately separated diagnostic surfaces:

1. a **default observer path** that reads facts Cordis already exposes without changing target dispatch behavior;
2. a **read-only Agent diagnostics / verification path** that performs targeted queries and before/after semantic comparison over those observer facts;
3. an **explicit opt-in waterfall instrumentation path** that measures listener/continuation execution only while profiling is enabled by a human DevTools action.

These boundaries are architectural. Observer facts, semantic verification, and profiler facts have different guarantees and must not be blended into a stronger claim than their source supports.

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
    │               authoritative live facts                      │
    │               + bounded dispatch history                    │
    │                                                             │
    └──────── Explicit waterfall instrumentation ─────────────┐    │
                                                              │    │
                 src/host/instrumentation/                    │    │
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
                                             │
                  ┌──────────────────────────┴───────────────────────┐
                  │                                                  │
                  ▼                                                  ▼
       browser observer/profiler RPC                    RuntimeDiagnosticsQuery
          /cordis-devtools                              read-only targeted facts
                  │                                                  │
                  ▼                                                  ▼
       Human Cordis DevTools                              Runtime Verification
 Events | Timeline | Fibers | Profiler              checkpoint projection + diff
                                                                     │
                                                        ┌────────────┴────────────┐
                                                        ▼                         ▼
                                              CordisRuntime Inspect          embedded MCP
                                                   DSH Agent               external Agent
                                                                        127.0.0.1 only
```

The browser, DSH Cordis Inspect, and MCP are adapters over Host-owned facts. None of them is a second runtime source of truth.

## Observer compatibility boundary

`src/host/cordis-adapter.ts` is the narrow boundary for direct listener-registry and live-Fiber implementation details. Downstream observer, Agent, and UI code consume project-owned snapshots rather than `_hooks` or raw Fiber internals.

The adapter owns:

- listener enumeration/order/owner metadata from the current Cordis hook registry;
- compact Fiber references;
- authoritative live Fiber inventory from `ctx.registry.values()` / runtime Fibers;
- normalization of known Fiber lifecycle states;
- `fiber.getEffects()` projection to recursive `EffectSnapshot { label, children }` metadata only.

No raw disposer/function/config/arguments/stacks are copied from Effects.

## Observer collector

`ObserverCollector` owns observer state and listens to Cordis lifecycle/dispatch invalidation signals.

`DispatchRecord` is intentionally a **pre-execution occurrence record**. It contains:

- runtime-local id;
- timestamp;
- invocation mode;
- event name;
- argument count;
- raw registered-listener count;
- known dispatch-context Fiber metadata.

It does not claim generic completion, executed-listener identity, listener duration, waterfall `next()` behavior, or chain-stop semantics.

The dispatch ring buffer is bounded. `internal/listener` invalidation is deferred because Cordis emits it before the Hook is stored; `internal/plugin` invalidation is deferred/coalesced so a disposing Fiber has left authoritative live inventory before subscribers refresh.

Observer mode never wraps target listener callbacks and never replaces Cordis `waterfall()` or its continuations.

## Runtime Diagnostics Query

`src/host/diagnostics.ts` provides transport-neutral targeted reads over facts already owned by `DevtoolsService`.

The v0.5 query surface is:

```text
runtimeSummary
inspectEvent
inspectFiber
searchDispatches
profilerTraces
captureCheckpoint
compareCurrent
```

The first five are v0.4 targeted reads. The last two compose the v0.5 Runtime Verification layer.

The query layer does not independently traverse Cordis internals. DSH Cordis Inspect and MCP delegate to it rather than rebuilding listener/Fiber semantics in each adapter.

## Runtime Verification

### Boundary

Runtime Verification is read-only with respect to the target Cordis runtime. It does not:

- reload plugins;
- add/remove listener registrations;
- enable waterfall instrumentation;
- persist server-side checkpoint state;
- return root-cause/fix/confidence verdicts.

It consumes a fresh `DevtoolsSnapshot`, projects a canonical checkpoint, and mechanically compares current topology with a caller-supplied baseline.

### Shared contract

`src/shared/verification.ts` owns the serializable v1 checkpoint/diff contract.

`src/host/verification/checkpoint.ts` owns checkpoint projection and digest generation. `src/host/verification/diff.ts` owns semantic multiset comparison.

A checkpoint is caller-owned:

```text
captureCheckpoint(scope?)
        ↓
serializable RuntimeCheckpoint
        ↓
caller keeps baseline
        ↓
compareCurrent({ baseline })
```

The Host does not allocate checkpoint ids, TTLs, history buffers, or per-Agent ownership state.

### Checkpoint topology

A checkpoint contains authoritative current topology:

- Events and current listener multiplicity;
- current listeners with capture-local registration metadata;
- authoritative live Fibers;
- parent/inject/owned-event metadata;
- metadata-only Effect structure.

Bounded dispatch history and profiler traces are excluded because they are retained occurrence history, not authoritative current topology.

Checkpoint scope supports exact Event/Fiber names with deterministic union + one-hop relationship closure. Normalized scope is stored in the checkpoint and reused by `compareCurrent`.

### Canonicalization and digest

Checkpoint arrays and metadata are canonicalized before hashing. The v1 digest is SHA-256 over the canonical body and is validated before comparison.

The digest protects checkpoint integrity/equality. It is not an object-identity mechanism.

### Cross-checkpoint identity

Runtime-local ids are evidence inside one capture, not stable identity across captures.

Listener semantic grouping uses:

```text
event
owner Fiber name / no owner
prepend
global
```

It deliberately excludes:

```text
listener id
owner Fiber uid
registration order
```

Registration `order` stays in the checkpoint as a factual capture-local property, but equivalent duplicate registrations naturally have different runtime order positions. Including it in the semantic key would split a duplicate topology into unrelated `1`-count rows rather than the required multiplicity `2 → 1`.

Fiber semantic grouping excludes Fiber uid and uses canonical factual metadata including name, state, parent name, sorted inject names, sorted owned events, and canonical metadata-only Effect structure.

Equal semantic descriptors are compared as multisets. The diff does not arbitrarily pair runtime objects.

### Result semantics

`compareCurrent`:

1. validates baseline schema/digest;
2. captures fresh current state with the baseline scope;
3. compares Event counts and Listener/Fiber semantic multisets;
4. returns the current checkpoint plus changed groups.

An unchanged comparison means only that authoritative checkpoint topology is semantically equal for that scope. It does not prove that every behavioral bug is fixed.

## Agent adapters

### DSH Cordis Inspect

When DSH provides the first-party `cordisInspect` registry, `src/host/cordis-inspect.ts` registers a `CordisRuntime` Provider.

DSH Agents use the existing `cordis_inspect_list` / `cordis_inspect_query` model tools. This package does not register a parallel package-specific model-tool family and does not route DSH through MCP.

### External MCP

`src/host/mcp.ts` optionally hosts MCP Streamable HTTP at:

```text
http://127.0.0.1:<port>/mcp
```

The server is:

- disabled by default;
- bound only to `127.0.0.1`;
- read-only for current Agent diagnostics/verification tools;
- lifecycle-owned by the plugin Fiber;
- fail-open for the Human DevTools path by default when the MCP listener cannot bind, with optional explicit `failOnStartupError`.

The seven MCP tools are thin adapters over `RuntimeDiagnosticsQuery`. MCP does not own a second checkpoint or diff implementation.

Loopback-only is a network exposure boundary, not a confidentiality boundary against untrusted local software running under the same machine/account.

## Waterfall instrumentation boundary

### Why instrumentation is separate

`internal/dispatch` fires before public listeners execute. Per-listener entry/timing, `next()` calls, async settlement, and repeated/late continuations cannot be derived truthfully from observer metadata.

Instrumentation is therefore explicit and separate from all Agent read-only operations.

### Seam

`WaterfallInstrumentationController` installs an **instance-level `ctx.events.dispatch` adapter** while enabled.

The design intentionally avoids:

- replacing `_hooks[].callback`, which would threaten unregister/disposer identity;
- replacing `EventsService.waterfall()`, whose native continuation behavior must remain authoritative;
- calling original dispatch and then re-filtering Hooks, which would execute `Context.filter` twice.

For non-waterfall modes the adapter delegates to the saved original dispatch path.

For waterfall mode the compatibility branch mirrors the validated Cordis selection/filter/bind behavior and returns **dispatch-local wrapped callbacks**. `_hooks` remain untouched.

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

The final continuation argument is replaced only by a transparent traced delegate. Every observed call gets its own record and delegates once to the original `next()`.

The trace contract records continuation facts rather than publishing an irreversible `shortCircuit`/`veto` boolean. A listener can retain `next()` and call it after returning.

### Async settlement limitation

To observe Promise settlement timing while returning the original Promise/thenable object, instrumentation attaches side observation. This can affect host-level handled/unhandled bookkeeping even though caller-visible Promise identity, value/reason, and propagation are preserved by the parity suite.

That trade-off exists only in explicitly enabled instrumented mode. Observer and Agent verification paths install no such observation.

### Compatibility and fail-closed behavior

Enable checks the expected Cordis runtime seam before patching. Disable restores the previous implementation only if DevTools still owns the installed wrapper.

If another component replaces `dispatch` while instrumentation is enabled, DevTools does not overwrite it during cleanup. The controller exposes `conflict` and fails closed.

Supported state is explicit:

- `disabled` — default, no DevTools dispatch patch;
- `enabled` — DevTools waterfall adapter owns the seam;
- `conflict` — another runtime patch owns the seam;
- `unsupported` — required compatibility assumptions are unavailable.

The current compatibility target is validated Cordis 4.0.1 behavior.

## Trace contract and storage

`src/shared/trace.ts` exposes only profiling metadata:

- trace/event timing facts and outcome;
- ordered listener spans and owner references;
- entered/returned/settled observations;
- recorded `next()` calls and outcomes;
- profiler instrumentation state.

It intentionally excludes raw listener arguments, return values, error objects/messages, prompts, tool results, file contents, plugin config, credentials, `selfTime`, and definitive chain-stop fields.

`WaterfallTraceStore` keeps a bounded set of serializable snapshots. Writes are upserts because late settlement/continuation facts can extend an existing trace. It is not a persistent or lossless audit database.

## Host service and browser transport

`DevtoolsService` composes:

- `ObserverCollector`;
- `WaterfallTraceStore`;
- `WaterfallInstrumentationController`;
- one `RuntimeDiagnosticsQuery` over the service-owned facts.

Browser observer/profiler RPC remains under `/cordis-devtools` with loopback authority. The observer snapshot never silently grows profiler traces or Agent checkpoint state.

Profiler reads/control remain separate:

```text
profiler/snapshot
instrumentation/enable
instrumentation/disable
```

Plugin disposal attempts to disable a DevTools-owned instrumentation patch. Conflict semantics remain fail-closed.

## Client state

### Observer store

`EventExplorerStore` owns one latest observer snapshot plus loading/stale/error state. Opening the panel fetches immediately and starts one one-second poller. View switching and cross-navigation are local UI state and do not create additional observer pollers.

### Profiler store

`ProfilerStore` is independent and active only while the panel is open and the Profiler tab is selected.

Opening Profiler performs a read-only snapshot. It never enables instrumentation automatically. Explicit enable/disable uses the Host-returned profiler snapshot and preserves the previous successful state as stale on failure.

Switching away or closing the panel stops profiler polling and aborts the active profiler request.

## Web UI boundary

The shell contributes once to `sidebar.footer.action` and owns four views:

- **Events** — current listener registry;
- **Timeline** — bounded observer dispatch occurrence window;
- **Fibers** — authoritative live Fiber/effect inventory;
- **Profiler** — bounded opt-in waterfall execution traces.

Cross-navigation uses live inventory as authority. Historical owner/context metadata remains readable but becomes non-navigable when its uid no longer exists in `DevtoolsSnapshot.fibers`.

## Core invariants

1. **Observer mode is behavior-neutral.** Installing/opening/polling never wraps target listeners or patches waterfall dispatch.
2. **Agent diagnostics and verification are read-only.** `captureCheckpoint` / `compareCurrent` observe current topology and never reload or instrument the target runtime.
3. **Instrumentation is explicit.** Entering Profiler is read-only; only the human enable action installs the adapter in v0.5.
4. **Unknown stays unknown.** Unsupported/incomplete facts are absent or described as current observations rather than fabricated conclusions.
5. **Authoritative topology stays separate from bounded history.** Checkpoints contain current Event/Listener/Fiber topology, not retained dispatch/profiler windows.
6. **Cross-checkpoint identity is semantic, not runtime-local.** id/uid/order fields remain evidence but are not silently promoted into stable identity.
7. **Multiplicity is preserved.** Equivalent duplicate Listener/Fiber descriptors compare as counts such as `2 → 1`.
8. **Metadata-first privacy.** Raw event/listener payloads, return values, error details, prompts, tool results, plugin config, file contents, credentials, and raw Effects do not cross current contracts.
9. **Histories are bounded.** Observer dispatches and profiler traces have independent configured retention limits.
10. **Lifecycle ownership is explicit.** Observers, channels, timers, MCP server, client pollers, and instrumentation cleanup belong to owning plugin/UI lifecycles.
11. **Transport is not a second source of truth.** Browser, Cordis Inspect, and MCP delegate to Host-owned facts and shared transformations.
12. **Live inventory stays live.** Historical Fiber references do not become authoritative current inventory.
13. **Instrumentation fails closed.** Unsupported/conflicting runtime seams are surfaced instead of silently patched or forcibly restored.
14. **Profiler timing stays factual.** The profiler exposes entered/returned/settled and `next()` observations, not undefined `selfTime` or irreversible chain-stop attribution.

## Testing layers

- Unit tests cover ring buffers, trace store, checkpoint canonicalization/digest, semantic diff, validators, and pure parity helpers.
- Real `@deepseek-ai/cordis` integration tests cover listener/Fiber/effect behavior, lifecycle transitions, waterfall behavior, instrumentation lifecycle/conflicts, and bounded metadata-only traces.
- Verification tests prove id/uid churn is not semantic identity and duplicate multiplicity is preserved; the final listener contract also proves registration `order` does not split equivalent duplicate groups.
- DSH Cordis Inspect tests exercise the real registry/provider seam where practical.
- MCP tests use the official SDK Client and require direct-query result parity.
- The paired waterfall parity suite compares caller-visible behavior with instrumentation absent vs enabled.
- `verify:client-bundle` executes the built client handoff through `window.__ModuleLoader__`.
- The real DSH Web E2E installs the built/current checkout into a disposable profile, then proves in one process:

```text
DSH Cordis Inspect baseline
external MCP baseline
        ↓
real Cordis duplicate topology 2 → 1
        ↓
DSH compareCurrent
MCP compareCurrent
        ↓
identical semantic Event / Listener / Fiber evidence
        ↓
Human DevTools UI + real waterfall Profiler remain healthy
```

E2E fixtures live under `e2e/fixtures` and are not included by the package `files` list, so they are not part of the production plugin runtime.