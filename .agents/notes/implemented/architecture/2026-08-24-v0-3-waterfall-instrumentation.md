# Agent Note: v0.3 waterfall instrumentation architecture

Status: implemented

## Problem

v0.2 observer mode can prove dispatch occurrence, listener registration, and live Fiber state, but cannot reliably answer which waterfall listeners entered, how long they ran, how often `next()` was called, or when async work settled.

The instrumentation boundary therefore had to be explicit, reversible, disabled by default, and protected against changes to Cordis callback/disposer identity or continuation semantics.

Discovery against the validated Cordis 4.0.1 behavior established that:

- `EventsService.dispatch()` resolves event/thisArg, emits `internal/dispatch`, applies `Context.filter`, and binds matching Hook callbacks;
- `EventsService.waterfall()` consumes the returned callback list using Cordis' native mutable continuation chain;
- unregister/disposal relies on callback identity stored in Hooks;
- `ctx.waterfall` dynamically forwards to the current events service.

## Decision

### Default observer mode remains uninstrumented

Installing the plugin, opening DevTools, normal snapshot polling, and merely entering the Profiler view do not modify target listeners, `_hooks`, `EventsService.waterfall()`, or `ctx.events.dispatch`.

Instrumentation requires an explicit loopback DevTools enable action and is not persisted across process restart.

### Use an instance-level `ctx.events.dispatch` adapter while enabled

The approved seam is the current runtime instance's `events.dispatch`, not Hook callback replacement and not a copied `waterfall()` implementation.

- non-waterfall modes delegate the saved original dispatch;
- waterfall mode performs the validated Cordis selection/filter/bind behavior once and returns dispatch-local wrapped callbacks;
- `_hooks[].callback` remains untouched;
- Cordis' native `waterfall()` keeps ownership of its `cbs.shift()` / continuation engine.

This avoids both callback-identity breakage and double execution of user-visible `Context.filter` logic.

### Use dispatch-local trace context

Every waterfall invocation has an independent trace context containing only metadata necessary for the current trace: trace/event identity, dispatch order, listener id/owner, entered timing, settlement facts, and observed continuation calls.

Nested/reentrant waterfalls create independent traces; v0.3 does not require AsyncLocalStorage parent/child reconstruction.

### Trace `next()` by transparent delegation

The listener wrapper replaces only the continuation argument passed into the target callback. Each observed call:

- appends a next-call record;
- immediately delegates exactly once to the original continuation;
- returns the original value/Promise/thenable;
- rethrows the same synchronous error;
- does not prohibit or coalesce repeated calls;
- allows a retained continuation to be called after listener return.

Because late calls are legal, v0.3 records continuation facts rather than freezing an irreversible `shortCircuit`/`veto` boolean at listener settlement.

### Preserve caller-visible sync/async identity

The wrapper is not `async`.

- synchronous values are returned directly;
- synchronous throws rethrow the same object;
- Promise/thenable results are returned as the same object;
- side observation is used only to obtain settlement timing/outcome metadata.

That side observation can affect host-level Promise handled/unhandled bookkeeping. This is an accepted cost only in explicitly enabled instrumented mode and is documented as such; the observer path remains free of it.

### Enable/disable fails closed

Enable verifies the expected compatibility seam before installing the adapter and is idempotent.

Disable/disposal restores the previous instance descriptor/implementation only if DevTools still owns the active wrapper. If another component replaced `dispatch`, DevTools does not overwrite it and exposes `conflict`. Missing compatibility assumptions expose `unsupported`.

Support is tied to validated runtime behavior, not merely to successful TypeScript compilation.

### Privacy remains metadata-first

Profiler traces do not store raw listener arguments, return values, error objects/messages, prompts, tool results, file contents, plugin config, credentials, or raw Effects.

## Alternatives considered

### Replace `_hooks[].callback`

Rejected because unregister/disposer/once/Fiber cleanup behavior depends on Hook callback identity and would become fragile, especially for listeners added/removed/restarted while instrumentation is active.

### Patch or reimplement `EventsService.waterfall()`

Rejected because the continuation engine being measured must remain Cordis-authoritative. Copying `cbs.shift()`/innermost-next/repeated-next behavior into DevTools would make the profiler a second waterfall implementation.

### Use `internal/dispatch` only

Rejected because it is pre-execution and cannot prove listener entry, duration, settlement, or continuation behavior.

### Call original dispatch then correlate Hooks by filtering again

Rejected because it would execute `Context.filter` twice, which is itself observable behavior.

### Block v0.3 until upstream exposes an official instrumentation hook

Rejected as a hard prerequisite. A narrow compatibility seam plus strict real-Cordis parity tests was accepted for v0.3, with the expectation that an official upstream seam should replace local compatibility logic if one becomes available.

## Consequences

The architecture has been implemented in `src/host/instrumentation/waterfall-controller.ts` and integrated through `DevtoolsService` / separate profiler RPC endpoints.

The resulting v0.3 behavior is:

- disabled by default;
- explicit and visible when enabled;
- waterfall-only;
- target Hook callback identity preserving;
- compatible with Cordis' native continuation engine;
- bounded through `WaterfallTraceStore`;
- fail-closed on unsupported/conflicting patches;
- metadata-only by contract;
- intentionally free of `selfTime` and definitive chain-stop fields.

The separate client Profiler store means ordinary observer polling does not transport profiler traces. Real DSH Web E2E plus an E2E-only real Cordis probe validates the full enable → trace → inspect → disable path.

## Verification

- trace contract and behavior-matrix suites cover zero/single/multiple, prepend/filter, sync/async, throw/reject, nested, repeated/late next, disposal, and restart;
- instrumentation-core tests cover lifecycle/identity/compatibility behavior;
- paired semantic parity compares caller-visible behavior between baseline and enabled contexts;
- overhead harness records disabled/enabled representative samples without a flaky hosted-runner budget;
- Host service/RPC tests cover default-disabled, bounded traces, separate observer snapshot, explicit control, disposal, and conflict;
- Profiler client tests cover read-only entry, explicit toggle, stale/error behavior, and owner navigation;
- real DSH Web E2E verifies explicit enable, a real Host waterfall trace rendered/expanded in Chromium, and explicit disable.
