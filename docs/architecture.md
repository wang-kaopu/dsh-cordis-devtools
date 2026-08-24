# Architecture

## Purpose

`dsh-cordis-devtools` exposes one live Cordis runtime through four deliberately separated layers:

1. **Observer** — behavior-neutral current facts plus bounded dispatch history.
2. **Runtime Diagnostics / Verification** — read-only targeted queries, caller-owned checkpoints, and semantic before/after diff.
3. **Waterfall instrumentation** — explicit metadata-only per-listener/continuation measurement for waterfall dispatches.
4. **Controlled Runtime Experiments** — the v0.6 authority/lifecycle layer that decides who may enable that instrumentation, for how long, and how it is safely stopped.

These layers have different evidence and side-effect guarantees. No adapter may upgrade a bounded observation into a complete-history claim or bypass the experiment authority layer to mutate the low-level controller.

## Runtime layers

```text
                               Cordis runtime
                                    │
              ┌─────────────────────┴──────────────────────┐
              │                                            │
              ▼                                            ▼
       ObserverCollector                     WaterfallInstrumentationController
 current Event/Fiber facts                     low-level compatibility seam
 + bounded dispatch history                              ▲
              │                                           │
              │                              mutation only through
              │                                           │
              │                           WaterfallExperimentCoordinator
              │                            single Human/Agent owner
              │                              ▲        ▲        ▲
              │                              │        │        │
              │                            Human     DSH      MCP
              └──────────────────┐           │       tools    tools
                                 ▼           │
                          DevtoolsService ────┘
                                 │
                  ┌──────────────┴─────────────────┐
                  │                                │
                  ▼                                ▼
         browser RPC / Profiler          RuntimeDiagnosticsQuery
                  │                       read-only facts/status
                  ▼                                │
          Cordis DevTools Web                      ▼
 Events | Timeline | Fibers | Profiler     Runtime Verification
                                               checkpoint + diff
                                                  /        \
                                                 ▼          ▼
                                         CordisRuntime     MCP
                                         Inspect Provider  loopback
```

The browser, DSH Cordis Inspect, DSH experiment tools, and MCP are adapters around Host-owned state. None is a second runtime source of truth.

## Observer compatibility boundary

`src/host/cordis-adapter.ts` isolates direct Cordis listener/Fiber implementation access. Downstream code consumes project-owned snapshots instead of raw `_hooks` or Fiber internals.

The observer projects:

- current listener registrations/order/owner metadata;
- authoritative live Fiber inventory from `ctx.registry`;
- parent/inject/owned-event relationships;
- `fiber.getEffects()` as metadata-only `{ label, children }` trees;
- bounded pre-execution dispatch occurrence records.

Observer mode never wraps target listener callbacks, never replaces Cordis `waterfall()`, and never patches dispatch.

`internal/dispatch` occurs before public listeners run, so observer records do not claim generic completion, actual executed listener identity, per-listener duration, `next()` behavior, or chain-stop attribution.

## Runtime Diagnostics and Verification

`src/host/diagnostics.ts` is the transport-neutral targeted query layer. The read surface includes:

```text
runtimeSummary
inspectEvent
inspectFiber
searchDispatches
profilerTraces
captureCheckpoint
compareCurrent
waterfallExperimentStatus
```

`profilerTraces` reads already-retained traces and may exact-filter by `experimentId`; it does not enable instrumentation.

Runtime Verification remains read-only. A checkpoint is a caller-owned, versioned, canonical JSON value containing authoritative current Event/Listener/live-Fiber topology and metadata-only Effects. Bounded dispatch history and profiler traces are excluded from checkpoints.

Cross-checkpoint semantic identity deliberately excludes runtime-local listener ids, Fiber/owner uids, and listener registration order. Listener groups use event + owner name + `prepend` + `global`; Fiber groups use canonical live metadata. Equivalent duplicates are compared as multisets, allowing mechanical changes such as `2 → 1` without inventing cross-reload object pairing.

`compareCurrent` validates the baseline, recaptures the same scope, and reports mechanical changes. It does not emit `fixed`, `rootCause`, or confidence.

## Controlled Runtime Experiments

### Single mutation owner

`src/host/instrumentation/waterfall-experiment-coordinator.ts` owns every production route that can mutate waterfall instrumentation.

The low-level `WaterfallInstrumentationController` remains the Cordis compatibility seam, but Human RPC, DSH tools, and MCP tools do not call its enable/disable methods directly.

Canonical owner states are factual:

```text
disabled + none
enabled  + human
enabled  + agent { leaseId, source: dsh|mcp, startedAt, expiresAt }
conflict
unsupported
```

Only one owner exists at a time.

### Human ownership

The browser Profiler acquires/relinquishes Human ownership through the coordinator. When an Agent lease is active, the UI identifies the Agent source/expiry and exposes a Human emergency stop rather than a normal Human-owned toggle.

Human emergency stop may always reduce instrumentation. Human enable does not steal an Agent lease, and an Agent cannot steal Human ownership.

### Agent lease lifecycle

Agent leases are finite:

```text
defaultTtlMs = 15000
maxTtlMs = 60000
```

There is no infinite lease, renewal, or simultaneous lease support in v0.6.

Start from an occupied/unsupported/conflicting state performs no mutation and returns factual status. Stop requires the exact active `leaseId`. Expiry also rechecks exact ownership before disabling. Stale stop/timeout callbacks cannot disable a later owner.

Plugin disposal clears timers and performs only owner-safe cleanup. If another component replaced the dispatch seam, cleanup preserves `conflict` instead of overwriting the foreign patch.

### Trace association

A waterfall trace created while an Agent lease owns instrumentation receives optional:

```text
experimentId = leaseId
```

Human traces remain untagged. Late settlement and late/repeated `next()` facts remain associated with the trace that originally observed them.

Trace storage remains bounded and upserted; `experimentId` filtering is not a lossless experiment log.

## DSH adapters

### Cordis Inspect remains read-only

`src/host/cordis-inspect.ts` registers the `CordisRuntime` Host Provider when the DSH `cordisInspect` service exists. DSH's existing `cordis_inspect_list` / `cordis_inspect_query` tools discover and invoke it.

The Provider exposes runtime facts, verification operations, and read-only experiment status. It does not expose experiment mutation.

### Dedicated experiment tools

`src/host/dsh-experiments.ts` registers:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

The start body obtains one-shot authority through the shipped DSH `ctx.approval` service **before coordinator mutation**. Only `allowed-once` proceeds. Missing Agent/service, rejection, cancellation, or unavailable answerer fail closed.

The mandatory gate lives in the tool body rather than solely in `tools/pre-execute`, whose extensible listener order cannot be trusted as the package's only mutation guard.

Stop requires the exact lease id and does not ask again because it only reduces instrumentation.

## External MCP adapter

`src/host/mcp.ts` optionally hosts Streamable HTTP at:

```text
http://127.0.0.1:<port>/mcp
```

Network exposure remains loopback-only and the server remains disabled by default.

Backward-compatible read-only config exposes the original seven v0.5 tools. Controlled-experiment mutation appears only when the operator explicitly supplies a non-empty bearer token and enables the experiment capability.

When a token is configured, every MCP request authenticates before request-body dispatch. Token material is not logged or copied into runtime output.

With experiments enabled, MCP adds read-only experiment status plus start/exact-stop tools. External MCP does not impersonate a DSH Agent or use DSH approval because it has no truthful DSH session identity.

MCP bind failure remains isolated from the Human observer path by default; deployments may opt into `failOnStartupError`.

## Waterfall instrumentation compatibility seam

Per-listener entry/timing and continuation facts cannot be derived from `internal/dispatch`, so the controller installs an instance-level `ctx.events.dispatch` adapter only while instrumentation is owned.

The design avoids:

- mutating `_hooks[].callback`;
- replacing native `EventsService.waterfall()` continuation semantics;
- double-running Cordis context filters.

For non-waterfall modes, dispatch delegates to the saved original path. For waterfall mode, the compatibility branch mirrors validated Cordis selection/filter/bind behavior and creates dispatch-local wrapped callbacks.

Wrappers preserve synchronous return values, thrown error identity, original Promise/thenable identity, callback order/binding, repeated `next()`, late `next()`, and nested/reentrant waterfall behavior. Promise settlement is side-observed for timing and can affect host handled/unhandled bookkeeping; that limitation exists only in explicitly instrumented mode.

The current compatibility target is validated Cordis 4.0.1 behavior.

## Privacy and evidence contracts

No current observer/checkpoint/trace contract transports:

- raw event/listener arguments;
- return values;
- error objects/messages;
- prompts or tool outputs;
- file contents or plugin config;
- credentials/bearer tokens;
- raw Effect disposer/function references.

The profiler does not invent `selfTime`, definitive `shortCircuit`/`veto`, root cause, confidence, or fix-success verdicts.

Bounded dispatch/trace windows report retained evidence only. Empty search results mean “not observed in the retained window,” not “never happened.”

## Lifecycle ownership

`DevtoolsService` composes observer, trace store, low-level controller, coordinator, and Runtime Diagnostics Query. Browser RPC, DSH adapters, and MCP delegate to that service-owned state.

Lifecycle-owned resources include observer subscriptions, timers, MCP server, client pollers, Agent lease expiry, and instrumentation cleanup. Disposal unwinds through the coordinator rather than having each adapter guess low-level ownership.

## Client state

Observer and profiler stores remain separate. Opening the panel starts observer polling; opening Profiler performs a read-only profiler snapshot and starts its own polling only while the view is active.

Human mutation is explicit. Agent-owned profiling is displayed as Agent-owned and cannot be confused with an ordinary Human session. Historical Fiber references remain readable but navigation requires the uid to still exist in authoritative live inventory.

## Core invariants

1. **Observer mode is behavior-neutral.** Installation/opening/polling does not patch target dispatch.
2. **Diagnostics and Runtime Verification are read-only.** Checkpoint/diff/status operations never instrument or reload the runtime.
3. **One coordinator owns mutation.** Human, DSH, and MCP do not maintain competing controller ownership.
4. **Agent starts require truthful authority.** DSH uses one-shot approval; external MCP uses explicit authenticated operator capability.
5. **Agent leases are finite and exact-owner checked.** Stale callers cannot disable later owners.
6. **Human emergency stop is authoritative.** It may always reduce instrumentation.
7. **Unknown stays unknown.** Unsupported/conflicting/incomplete facts are surfaced instead of fabricated conclusions.
8. **Authoritative topology is separate from bounded history.** Checkpoints do not contain retained dispatch/trace windows.
9. **Cross-checkpoint identity is semantic, not runtime-local.** id/uid/order remain capture evidence.
10. **Multiplicity is preserved.** Equivalent duplicates compare as counts.
11. **Metadata-first privacy is preserved.** Raw payload/credential data does not enter current contracts.
12. **Transport is not a second source of truth.** Browser, Cordis Inspect, DSH tools, and MCP delegate to Host state.
13. **Instrumentation fails closed.** Conflict/unsupported never force restoration of a foreign seam.
14. **Trace attribution is factual, not complete-history proof.** `experimentId` identifies origin while retention stays bounded.

## Testing layers

- unit tests cover checkpoint/diff contracts, ring buffers, trace store, coordinator state machine, auth/capability validation, and client stores;
- real Cordis tests cover listener/Fiber/effect behavior, instrumentation/parity, trace tagging, lifecycle/conflict, TTL/ownership races;
- DSH adapter tests cover approval-first and fail-closed outcomes;
- MCP tests use the official SDK Client and exact query/control delegation;
- React/jsdom tests cover Agent owner presentation and Human emergency-stop interaction;
- built-client verification executes the real bundle handoff;
- `pnpm test:e2e:web` runs two disposable real DSH Web smokes:

```text
v0.5: DSH Cordis Inspect + external MCP Runtime Verification 2 → 1
        ↓
v0.6: real SessionStore/ToolRuntime/ApprovalService DSH experiment
      + authenticated official MCP experiment
      + exact experimentId traces
      + stale-stop / TTL / Human emergency stop
      + ordinary Human Profiler recovery
```

The v0.6 fixture uses an authoritative live SessionStore session and real open turn. It intentionally does not mock away DSH session authority and requires no model/API key.

## Deferred work

Outside v0.6: automatic reload/orchestration, arbitrary event execution, generic listener/service/config mutation, persistent approvals, lease renewal/concurrency, remote MCP, payload capture, root-cause `diagnose()` verdicts, and non-waterfall profiling.