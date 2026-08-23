# Agent Note: Formalize the live Event / Listener Registry

Status: implemented

## Problem

The initial scaffold exposed a raw `listeners` array by reading Cordis `ctx.events._hooks`, but it did not define an event-level registry contract or protect listener ownership/order/lifecycle semantics with tests against the real Cordis implementation.

The collector also treated `internal/listener` as if it were a post-registration signal. Cordis actually emits that interception event before the new hook is inserted into `_hooks`, so a synchronous subscriber refresh could observe the old registry.

Dispatch mode is selected per invocation (`emit`, `parallel`, `serial`, `bail`, or `waterfall`), so it is not a static property of an event name.

## Decision

The v0.1 Event / Listener Registry is a host/shared contract backed by the live Cordis listener registry. Direct knowledge of `_hooks` remains isolated in `src/host/cordis-adapter.ts`.

`DevtoolsSnapshot` now exposes `events: EventSnapshot[]`, where each event contains its name, current listener count, and listener ids in the exact order present in Cordis's live hook array. Only events with at least one live listener appear.

`ListenerSnapshot` remains the detailed registration record: event name, current order, `prepend`, `global`, and owning fiber metadata. Ownership is sourced from the hook's registering context (`hook.ctx.fiber`), not from plugin-declared metadata.

Listener ids are runtime-local identities keyed to the live hook registration object. They remain stable across repeated snapshots while that registration exists, but they are not persistent across disposal, restart, or process restart.

No static `mode` field is added to `EventSnapshot`. Concrete dispatch mode remains on `DispatchRecord`, where it is an observed fact for one invocation.

`internal/listener` is used only as an invalidation signal. Collector notification is scheduled into a microtask and coalesced so the normal `ctx.on()` registration finishes before subscribers refresh from `_hooks`. The collector does not wrap `ctx.on()`, replace dispatch methods, or intercept unregister paths.

The registry contract is protected by integration tests using the actual `@deepseek-ai/cordis` dependency. They cover pre-existing listeners, real listener order and flags, fiber ownership, stable live ids, restart/disposal, post-registration subscriber invalidation, and behavior-neutral event dispatch.

## Alternatives considered

**Keep only `listeners[]` and let each client group events.** Rejected because Web UI, CLI, and exporters would otherwise define event existence and listener ordering independently. The shared event projection is small and removes that semantic duplication.

**Add a single `mode` field to each event.** Rejected because Cordis chooses dispatch mode per call. A static mode would present an inference as a runtime fact.

**Build registry state incrementally from `internal/listener`.** Rejected because it is emitted before insertion, has no symmetric unregister event, and cannot reconstruct registrations that predate DevTools startup.

**Wrap registration/unregistration to obtain perfect change callbacks.** Rejected for observer mode because it changes the mechanism being inspected and creates a larger compatibility surface than reading the authoritative live registry.

**Start with a Web UI.** Rejected because collection semantics need to be stable and tested before presentation is added.

## Consequences

The shared snapshot now has an explicit event-level contract that future presentation layers can consume without reverse-engineering Cordis or regrouping listener records themselves.

The feature remains dependent on the internal `_hooks` representation. Cordis upgrades can therefore break the adapter, but that compatibility risk is localized and now covered by real integration tests.

Registry notifications are refresh hints rather than a lossless operation log. Multiple synchronous listener registrations may coalesce into one notification, and removal is observed through the live registry plus Cordis lifecycle signals rather than a dedicated unregister event.

Events with zero live listeners are intentionally absent. Listener ids are diagnostic runtime identities only and must not be persisted.

Web UI, timing instrumentation, `next()` tracing, payload capture, static event-mode inference, and historical registry storage remain out of scope.
