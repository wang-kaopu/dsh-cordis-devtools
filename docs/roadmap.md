# Roadmap to v0.3

This document records the completed path from the observer-only v0.2 DevTools to the explicit opt-in v0.3 waterfall profiler. It remains useful as a milestone/evidence map, but I0–I6 are no longer pending work.

## Product boundary

```text
v0.2 — observer Web DevTools
  inspect facts Cordis already exposes
  do not wrap target listeners
  do not change dispatch semantics

v0.3 — opt-in waterfall profiler
  explicit enable / disable
  instrument only the waterfall execution seam
  keep the default observer path behavior-neutral
  expose only facts the instrumentation can prove
```

The split is architectural. `internal/dispatch` fires before public listeners execute, so observer mode cannot truthfully provide generic completion, per-listener timing, `next()` attribution, or waterfall continuation facts.

## v0.2 — Observer Web DevTools ✅ complete

### Delivered work

- **O1 — Client view split** ✓ — `DevtoolsShell.tsx` owns shared panel/poll/filter/navigation state while Events, Timeline, and Fibers live in stable view files.
- **O2 — Cross-view navigation** ✓ — live listener owners and dispatch contexts can open Fibers; owned live Events navigate back to Events; historical disposed references remain metadata only.
- **O3 — Fiber Effects Inspector** ✓ — live `fiber.getEffects()` metadata is projected as `label + children` and rendered recursively with DSH disclosure primitives.
- **O4 — Real DSH Web E2E** ✓ — CI installs the current checkout into a disposable Web profile and verifies the real sidebar composition in Chromium.
- **O5 — v0.2 release hardening** ✓ — package metadata moved to `0.2.0`; bounded dispatch retention, metadata-only observer capture, and no-target-listener-wrapper invariants received dedicated regression coverage.

### v0.2 invariants

- observer mode never wraps or replaces target listeners;
- live listener/Fiber/effect data comes from Cordis runtime state rather than browser reconstruction;
- dispatch history is bounded and explicitly presented as a recent window rather than a lossless audit log;
- raw dispatch arguments, prompts, tool results, plugin config, file contents, credentials, and raw effect functions/disposers are not collected by default;
- historical dispatch Fiber references never become authoritative live Fiber state;
- Host-to-browser diagnostics remain loopback-only.

## v0.3 — Instrumented Waterfall Profiler ✅ repository-ready

### Goal actually delivered

v0.3 answers the observer questions that require execution-time evidence while preserving the default observer path:

- which waterfall listeners entered;
- listener entered/returned/settled timing facts;
- listener outcome categories;
- every observed `next()` call, including repeated or late calls;
- bounded trace snapshots that can be revised as later facts arrive;
- explicit runtime instrumentation state and reversible/fail-closed lifecycle.

v0.3 is intentionally limited to **waterfall** dispatch. `emit`, `parallel`, `serial`, and `bail` profiling remain later design work.

### I0 — Instrumentation architecture checkpoint ✅

The approved architecture chose an instance-level `ctx.events.dispatch` compatibility adapter while profiling is enabled.

Key decisions:

- default observer mode installs no dispatch patch;
- `_hooks[].callback` identity is never replaced;
- Cordis' native `waterfall()` continuation engine is not rewritten;
- non-waterfall dispatch delegates the original implementation;
- waterfall mode mirrors the validated selection/filter/bind behavior once per Hook and wraps only dispatch-local callbacks;
- sync return, same thrown error object, original Promise/thenable identity, order, `this`, repeated `next()`, late `next()`, and nested/reentrant waterfall remain caller-visible parity requirements;
- enable/disable is compare-and-restore/fail-closed rather than forceful monkey-patching;
- payload capture remains out of scope.

The design also explicitly rejected publishing `selfTime` or an irreversible `shortCircuit` boolean before their semantics survive repeated/late continuation and async/reentrant cases.

### I1 — Trace contract and waterfall behavior matrix ✅

A serializable metadata-only contract was frozen before transport/UI integration:

```text
WaterfallDispatchTrace
  version / trace id / event
  started / returned / settled facts
  outcome
  ordered listener spans

WaterfallListenerSpan
  runtime-local listener id
  owner Fiber reference
  dispatch order
  entered / returned / settled facts
  outcome
  next-call records

WaterfallNextCall
  call index
  called / returned / settled facts
  outcome
```

The real Cordis behavior matrix covers zero/single/multiple listeners, no-next behavior, prepend/filtering, sync and async before/after next, throw/reject, nested waterfall, repeated/late next, listener disposal, and restart.

### I2 — Opt-in instrumentation core ✅

Production instrumentation is disabled by default and enabled only by explicit control.

The controller:

- patches only the current `ctx.events.dispatch` instance seam after compatibility checks;
- keeps target Hook callback identity untouched;
- returns original caller-visible values/Promise identities;
- records dispatch-local listener/continuation facts;
- restores its own patch on disable/disposal;
- reports `conflict` instead of overwriting a third-party replacement;
- reports `unsupported` when the expected Cordis compatibility seam is unavailable.

### I3 — Semantic parity and overhead evidence ✅

The paired parity harness runs the same scenarios in separate baseline and instrumented Cordis contexts and compares caller-visible results rather than using trace output as the correctness oracle.

Covered parity facts include result/error propagation, order, `this`, Promise/error identity facts, nested waterfall, repeated/late next, listener disposal, and plugin restart.

The overhead harness records representative disabled/enabled samples and produces mean/min/max evidence. CI intentionally does **not** impose an arbitrary percentage budget because hosted-runner timing is noisy; the harness is a regression/measurement baseline rather than a synthetic performance SLA.

### I4 — Bounded trace storage and transport ✅

Profiler traces use a dedicated bounded `WaterfallTraceStore` and a separate loopback RPC path.

The existing observer `snapshot` remains unchanged. Profiler endpoints are:

- `profiler/snapshot`;
- `instrumentation/enable`;
- `instrumentation/disable`.

Trace writes are upserts so a bounded in-memory trace can gain settlement or late-continuation facts while retained. No v0.3 surface claims cursor delivery, persistence, or lossless audit semantics.

### I5 — Waterfall Profiler UI ✅

The DSH sidebar DevTools now has four views:

`Events | Timeline | Fibers | Profiler`

Profiler UX properties:

- opening Profiler is read-only and does not auto-enable instrumentation;
- instrumentation status is visible;
- explicit `Enable profiling` / `Disable profiling` controls mutate the Host only on user action;
- `conflict` / `unsupported` do not expose misleading toggles;
- observer Timeline and instrumented traces are separate views/transports;
- listener owners can navigate to live Fibers;
- repeated/late `next()` calls are shown as observed facts;
- raw arguments remain hidden;
- no `selfTime`, irreversible `veto`, or definitive short-circuit field is presented.

Profiler polling is active only while the Profiler tab is selected. It uses a separate client store from the panel-open observer poller.

### I6 — v0.3 integration and release hardening ✅

Release-hardening closes the repository milestone without publishing externally:

- package metadata is `0.3.0`;
- default observer behavior-neutrality remains protected by v0.2 hardening tests;
- v0.3 hardening directly protects default-disabled instrumentation, observer/profiler separation, bounded metadata-only trace retention, disable restoration, and fail-closed conflict behavior;
- the shared contract remains free of unsupported `selfTime` / irreversible short-circuit fields and raw payload capture;
- real Cordis behavior/parity suites pass in baseline and instrumented modes;
- real DSH Web E2E installs an E2E-only Cordis waterfall probe and verifies `disabled → explicit enable → real Host waterfall trace → expand/inspect next fact → explicit disable` in Chromium;
- README and architecture document bounded retention, privacy, Promise side-observation limitations, and the explicit opt-in lifecycle;
- approved v0.3 architecture/planning Agent Notes are closed into `implemented`.

No I6 completion claim means an npm publish or Git tag has occurred. Those remain separate maintainer actions.

## v0.3 invariants

1. Default observer installation/opening/polling does not patch target listener callbacks or waterfall dispatch.
2. Entering Profiler is read-only; instrumentation requires an explicit user action.
3. Instrumentation targets waterfall only; other modes delegate the original dispatch path.
4. `_hooks[].callback` identity remains untouched.
5. Trace retention is bounded and separate from observer dispatch retention.
6. Raw listener arguments, return values, error details, prompts, tool results, files, config, credentials, and raw Effects do not cross the current contracts.
7. Repeated/late `next()` remains legal behavior and is recorded rather than normalized away.
8. Unsupported/conflicting compatibility seams fail closed.
9. Profiler timing fields are direct entered/returned/settled observations rather than inferred `selfTime`.
10. Neither Timeline nor Profiler claims persistent/lossless audit semantics.

## Explicitly deferred beyond v0.3

Unless new evidence changes priorities:

- generic profiling for `emit` / `parallel` / `serial` / `bail`;
- a stable `selfTime` metric across async/repeated/reentrant continuation behavior;
- irreversible `shortCircuit` / `veto` conclusions from incomplete continuation evidence;
- raw argument, return-value, or error-detail capture;
- payload diffing/redaction UI;
- nested trace parent/child reconstruction through global async context;
- persistent profiler database;
- cursor/watch streaming with gap detection/backpressure;
- remote/non-loopback diagnostics;
- full service dependency graph / plugin topology visualization;
- mutation controls such as arbitrary plugin restart/dispose from this DevTools surface;
- a promise of lossless audit logging.

## Planning rule after v0.3

Milestone completion does not weaken the repository workflow. New architecture/shared contracts/instrumentation semantics still require discovery → proposed Agent Note → maintainer checkpoint when decision-sensitive → implementation → verification → self-review.

Future profiler work should extend the current explicit instrumented mode rather than silently adding execution-time claims to the observer Timeline.
