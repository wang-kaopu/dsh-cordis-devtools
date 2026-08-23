# Roadmap to v0.3

This document turns the milestone bullets in the README into implementation-sized work with explicit exit criteria. It is intentionally conservative about observability: v0.2 remains observer-only, while v0.3 introduces a separate opt-in instrumented mode.

## Product direction

`dsh-cordis-devtools` evolves in two clearly separated stages:

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

## v0.2 — Observer Web DevTools ✅ complete

### Goal

Provide a coherent read-only diagnostic workflow before crossing into instrumentation. A maintainer can move from an event or dispatch to the responsible Fiber and inspect lifecycle effects that Cordis already exposes.

### Delivered work

- **O1 — Client view split** ✓ — `DevtoolsShell.tsx` owns shared panel/poll/filter/navigation state while Events, Timeline, and Fibers live in stable view files.
- **O2 — Cross-view navigation** ✓ — live listener owners and dispatch contexts can open Fibers; owned live events can navigate back to Events; historical disposed references remain non-live metadata.
- **O3 — Fiber Effects Inspector** ✓ — live `fiber.getEffects()` metadata is projected as `label + children` only and rendered recursively with DSH disclosure primitives.
- **O4 — Minimal real DSH Web E2E** ✓ — CI installs the current checkout through the published DSH CLI into a disposable profile, boots DSH Web, completes supported onboarding, and verifies the real sidebar DevTools composition in Chromium.
- **O5 — v0.2 release hardening** ✓ — package metadata is `0.2.0`; dedicated regression tests protect bounded dispatch retention, metadata-first argument handling, and the no-target-listener-wrapper observer invariant; full repository and real Web gates remain required.

### v0.2 invariants

- observer mode never wraps or replaces target listeners;
- live listener/Fiber/effect data comes from Cordis runtime state rather than browser reconstruction;
- dispatch history is bounded and explicitly presented as a recent window rather than a lossless audit log;
- raw dispatch arguments, prompts, tool results, plugin config, file contents, credentials, and raw effect functions/disposers are not collected by default;
- historical dispatch Fiber references never get promoted into authoritative live Fiber state;
- Host-to-browser diagnostics stay loopback-only;
- one browser snapshot store/poller remains the source for all three views;
- every displayed fact is either authoritative live state or explicitly bounded/derived state.

### v0.2 diagnostic loop

```text
Event ──owner──► Fiber ──effects──► lifecycle registrations
  ▲                ▲
  │                │
  └─ owned facts   └── dispatch context ── Timeline
```

No v0.2 completion claim implies npm publication, a Git tag, or any waterfall instrumentation. Those are separate maintainer decisions.

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

Milestone text is not implementation approval. Any decision-sensitive task still follows `development-loop`: discover → proposed Agent Note → maintainer checkpoint → implementation. In particular, **I0 must be approved before v0.3 production instrumentation begins**.
