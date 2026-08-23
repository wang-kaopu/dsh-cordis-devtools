# Roadmap to v0.3

This document turns the milestone bullets in the README into implementation-sized work with explicit exit criteria. It is intentionally conservative about observability: v0.2 remains observer-only, while v0.3 introduces a separate opt-in instrumented mode.

## Product direction

`dsh-cordis-devtools` should evolve in two clearly separated stages:

```text
v0.2 — observer Web DevTools
  inspect facts Cordis already exposes
  do not wrap target listeners
  do not change dispatch semantics

v0.3 — instrumented waterfall profiler
  explicit opt-in
  wrap/instrument only where measurement requires it
  preserve a behavior-neutral observer path when disabled
```

The split is architectural, not cosmetic. `internal/dispatch` fires before public listeners execute, so observer mode cannot truthfully produce generic completion, per-listener latency, `next()` attribution, or short-circuit facts.

## Current baseline

Already shipped on `main`:

- live Event / Listener Registry;
- listener ordering, `prepend` / `global`, and owner-fiber metadata;
- bounded recent Dispatch Timeline;
- authoritative live Fiber Registry from `ctx.registry`;
- readable fiber lifecycle state, parent, and inject metadata;
- DSH Web surface with `Events`, `Timeline`, and `Fibers`;
- DSH UI primitive reuse and sidebar-footer alignment;
- one loopback-only Host → browser snapshot RPC;
- one visible-only browser poller with stale-state behavior;
- real Cordis integration tests, jsdom/React tests, and built-client module-loader smoke verification.

## v0.2 — Observer Web DevTools

### Goal

Finish a coherent read-only diagnostic workflow before crossing into instrumentation. A maintainer should be able to move from an event or dispatch to the responsible fiber and inspect the lifecycle effects that Cordis already exposes.

### Remaining work

#### O1 — Split the Web views into stable files

Pure behavior-preserving refactor of the current large `EventExplorer.tsx`.

Target shape:

```text
src/client/
├─ DevtoolsShell.tsx
├─ views/
│  ├─ EventsView.tsx
│  ├─ TimelineView.tsx
│  └─ FibersView.tsx
└─ ...
```

Purpose:

- reduce merge conflicts between parallel UI tasks;
- keep shared panel/open/poll/filter/navigation state in one shell;
- keep view-specific layout and tests local;
- do not introduce a routing library or new client state source.

Acceptance:

- no visible behavior change;
- existing component tests continue to pass;
- one sidebar contribution, one snapshot store, one poller remain true.

#### O2 — Cross-view navigation

Connect the existing diagnostic facts instead of leaving three isolated views.

Required paths:

- Events listener owner → selected Fiber;
- Timeline dispatch context → selected Fiber;
- Fiber owned event/listener summary → corresponding Events context where the target still exists in the live registry.

Rules:

- navigation is presentation state only;
- historical dispatch fiber references may point to a disposed fiber, so the UI must degrade to an unavailable/live-missing state instead of fabricating a live Fiber entry;
- no new Host API is required for navigation itself.

#### O3 — Fiber Effects Inspector

Use Cordis' diagnostic `fiber.getEffects()` API. Cordis describes it as one `EffectMeta` tree per labeled live effect, where each node has a human-readable `label` and nested `children`.

Expose only:

```text
Effects
├─ ctx.on("...")
├─ ctx.provide("...")
└─ custom labeled effect
   └─ nested labeled effect
```

Rules:

- effect data belongs to the live Fiber snapshot, not historical dispatch records;
- preserve label + tree structure only;
- no raw disposer/function references;
- no plugin config, intercept values, stacks, captured arguments, file contents, or credentials;
- empty/unlabeled effects remain honestly absent rather than reconstructed from unrelated registries.

#### O4 — Minimal real DSH Web E2E

Add the smallest maintainable browser/profile smoke harness that validates composition beyond jsdom.

Minimum scenario:

1. build the package;
2. install/link it into a disposable DSH Web profile;
3. start DSH Web;
4. open Cordis DevTools from the real sidebar footer;
5. switch Events → Timeline → Fibers;
6. assert the panel renders and the snapshot RPC succeeds;
7. close the panel and verify no visible fatal error / broken module-loader path.

Desirable follow-ups after the baseline exists:

- collapsed sidebar trigger;
- dark/light theme smoke;
- one cross-navigation path;
- one Effects expansion path.

This harness should validate integration, not duplicate component-level assertions.

#### O5 — v0.2 release hardening

Before calling v0.2 complete:

- README and architecture match shipped behavior;
- observer-only invariants remain enforced;
- all diagnostic histories remain bounded;
- default collection remains metadata-first;
- no target listener wrapper exists in the disabled/default path;
- full policy/typecheck/test/build/client-bundle checks pass;
- real DSH Web smoke passes.

### v0.2 exit criteria

v0.2 is complete when a user can follow this read-only diagnostic loop:

```text
Event ──owner──► Fiber ──effects──► lifecycle registrations
  ▲                ▲
  │                │
  └─ owned facts   └── dispatch context ── Timeline
```

and every displayed fact is either authoritative live state or explicitly labeled bounded/derived state.

## v0.3 — Instrumented Waterfall Profiler

### Goal

Add an explicit opt-in mode that can answer questions observer mode fundamentally cannot:

- which waterfall listeners actually entered;
- how long each listener took;
- whether and how `next()` was called;
- where the chain stopped;
- how listener-local work relates to downstream waterfall work.

v0.3 is intentionally limited to **waterfall** dispatch. `emit`, `parallel`, `serial`, and `bail` profiling are later decisions rather than automatic extensions.

### Upstream semantics the design must preserve

Cordis waterfall currently:

1. resolves the filtered listener callback list;
2. treats the final argument as the innermost built-in `next`;
3. creates a continuation that shifts the next callback from the list;
4. passes that continuation as the final argument;
5. lets each listener decide whether to call it;
6. returns the outermost result.

Not calling `next()` vetoes the rest of the chain. A profiler therefore cannot infer waterfall execution from listener registration order or `internal/dispatch`; it must observe execution around the real callback/continuation path.

### I0 — Instrumentation architecture checkpoint

No production listener wrapping should begin before an approved architecture Agent Note resolves:

- instrumentation seam: hook callback wrapping, waterfall dispatch seam, or another isolated adapter strategy;
- exact install/uninstall lifecycle;
- ordering and `this` preservation;
- sync return vs promise settlement semantics;
- thrown/rejected error propagation;
- nested/reentrant waterfall dispatch;
- multiple `next()` calls and their trace model;
- callback identity / unregister compatibility;
- context filtering and `prepend` / `global` behavior;
- overhead measurement;
- privacy and retention;
- version-compatibility boundary around Cordis internals.

### I1 — Trace contract and waterfall behavior matrix

Freeze a serializable trace contract before building the UI.

Candidate facts, subject to I0 approval:

```text
WaterfallDispatchTrace
  dispatch id / trace id
  event
  started / settled timestamps
  outcome category
  ordered listener spans

WaterfallListenerSpan
  listener registration id
  owner fiber reference
  order at dispatch
  entered / settled timestamps
  total elapsed
  next call count
  downstream trace relation
  outcome category
```

Do **not** publish a `selfTime` field until its semantics are defined for async work, repeated `next()` calls, and reentrancy. If the metric cannot remain meaningful for those cases, expose narrower timing facts instead of a misleading number.

The behavior matrix must include at least:

- zero listeners;
- one listener calling `next()`;
- listener veto / no `next()`;
- multiple listeners;
- async listener before/after `next()`;
- thrown error;
- rejected promise;
- nested waterfall;
- repeated `next()`;
- filtered listeners;
- `prepend` ordering;
- listener disposal/restart while instrumentation is enabled.

### I2 — Opt-in instrumentation core

Requirements:

- disabled by default;
- enabling is explicit and visible;
- installing DevTools with instrumentation disabled does not wrap target listeners;
- disabling/disposal restores the original runtime behavior and identities required for cleanup;
- implementation-specific Cordis access stays behind the Host compatibility boundary;
- instrumentation state and traces are bounded.

The exact user-facing enable mechanism (plugin config, DevTools-local control, or another explicit mechanism) is decided in I0 rather than assumed here.

### I3 — Instrumentation parity and overhead harness

Prove two separate properties:

**Semantic parity**

For the waterfall behavior matrix, compare instrumented and uninstrumented results, errors, order, `this`, and externally observable side effects.

**Overhead**

Measure representative waterfall dispatch cost with instrumentation disabled and enabled. The initial goal is evidence and a regression baseline, not an arbitrary performance budget invented before measurements exist.

### I4 — Bounded trace storage and transport

Keep the existing observer snapshot semantics intact. Instrumented traces should have an explicit retention boundary and must not silently turn the existing one-second polling Timeline into a claimed lossless stream.

If polling is no longer adequate for profiler traces, introduce a separate transport decision covering:

- revision/cursor semantics;
- gap detection;
- reconnect;
- cancellation;
- backpressure;
- trace retention.

Do not smuggle a watch protocol into an unrelated UI PR.

### I5 — Waterfall Profiler UI

Only after the trace contract stabilizes.

The UI should reuse DSH primitives and existing DevTools navigation. A likely shape is a dedicated profiler view or a Timeline detail mode, chosen after trace density is known.

Required UX properties:

- instrumentation status is unmistakable;
- observer Timeline and instrumented traces are not visually conflated;
- listener order/owner link back to existing Events/Fibers views;
- short-circuit/veto is shown only when proven by the continuation trace;
- raw arguments remain hidden by default.

### I6 — v0.3 integration and release hardening

Before calling v0.3 complete:

- default observer mode remains behavior-neutral;
- explicit instrumentation enable/disable lifecycle is tested;
- real Cordis waterfall matrix passes in both modes;
- real DSH Web E2E covers enable → trace → inspect → disable;
- bounded retention and privacy semantics are documented;
- instrumentation overhead baseline is recorded;
- no unsupported timing/outcome fact is presented as authoritative.

## Explicitly deferred beyond v0.3

Unless new evidence changes priorities:

- generic profiling for `emit` / `parallel` / `serial` / `bail`;
- raw argument or return-value capture;
- payload diffing;
- full service dependency graph;
- plugin topology visualization;
- mutation controls such as restart/dispose;
- persistent profiler database;
- remote/non-loopback diagnostics;
- a promise of lossless audit logging.

## Planning rule

Milestone text is not implementation approval. Any decision-sensitive task still follows `development-loop`: discover → proposed Agent Note → maintainer checkpoint → implementation. In particular, I0 must be approved before v0.3 production instrumentation begins.
