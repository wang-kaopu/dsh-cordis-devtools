# Agent Note: Formalize the live Event / Listener Registry

Status: proposed

## Problem

The initial scaffold already exposes a raw `listeners` array by reading Cordis `ctx.events._hooks`, and it records observed fibers and dispatches. That is enough to prove the direction, but it is not yet a finished Event / Listener Registry contract.

Three gaps remain before the registry should be treated as a supported feature:

1. there is no explicit event-level snapshot, so every future client/CLI/exporter would need to regroup listeners and choose its own semantics;
2. the registry behavior is not covered by integration tests against the real `@deepseek-ai/cordis` implementation, so listener order, ownership, disposal, restart, and notification timing are currently assumptions rather than protected behavior;
3. `internal/listener` fires before Cordis inserts the new hook into `_hooks`, while the current collector notifies subscribers synchronously, so a subscriber can refresh immediately and still observe the pre-registration snapshot.

Cordis stores each live listener as a hook containing the registering `Context`, callback, `prepend`, and `global` flags. Listener execution order is the live hook-array order, and `hook.ctx.fiber` is the authoritative owner. Cordis also ties `ctx.on()` registrations to the owning fiber lifecycle, so disposal removes the hook.

Dispatch mode is different: `emit`, `parallel`, `serial`, `bail`, and `waterfall` are selected by each dispatch call. A mode is therefore not an intrinsic property of an event name and must not be presented as one.

## Proposal

Ship v0.1 of the Event / Listener Registry as a host/shared contract backed by the live Cordis registry, without adding UI or instrumentation.

### 1. Add an explicit event snapshot

Add a transport-neutral type similar to:

```ts
export interface EventSnapshot {
  name: string
  listenerCount: number
  listenerIds: number[]
}
```

and expose `events: EventSnapshot[]` from `DevtoolsSnapshot`.

`events` is derived from the current live listener snapshot. An event appears when it currently has at least one registered listener. `listenerIds` preserves the current Cordis execution order for that event.

This contract intentionally does not include `mode`. Dispatch mode remains on `DispatchRecord`, where it is an observed fact for one concrete dispatch. If a future UI summarizes modes, that summary must be explicitly labeled as observed/recent rather than as a static event property.

### 2. Keep listener facts sourced from `_hooks`

`ListenerSnapshot` continues to expose:

- event name;
- current order within the event hook array;
- `prepend` and `global` flags;
- owning fiber uid/name/state when Cordis exposes it.

Direct `_hooks` access remains isolated in `src/host/cordis-adapter.ts`.

Listener ids are runtime-local registration identities. They only need to remain stable while the same hook registration remains live; they are not persistent ids across disposal, restart, or process restart. Prefer keying the id to the live hook record rather than relying on callback identity.

### 3. Make listener-registration invalidation post-registration

Do not mutate or replace Cordis registration behavior.

When `internal/listener` is observed, schedule/coalesce the collector notification into a microtask so a normal `ctx.on()` call finishes inserting its hook before subscribers refresh. The notification remains only an invalidation signal; the snapshot itself is always rebuilt from authoritative runtime state.

Lifecycle-driven removal continues to rely on live `_hooks` plus Cordis lifecycle notifications. No private unregister interception or EventService monkeypatching is introduced.

### 4. Prove the contract with real Cordis integration tests

Add integration coverage using the repository's actual `@deepseek-ai/cordis` dependency, not a fake event bus.

The tests should create real plugin fibers and prove at least:

- normal and `prepend` listeners appear in actual execution order;
- `global` is reflected correctly;
- each listener is attributed to the registering fiber with the real uid/name/state;
- two separate registrations have distinct runtime listener ids and ids remain stable across repeated snapshots while those registrations stay live;
- disposing a plugin removes its listeners from the registry;
- restarting/reloading a plugin does not accumulate duplicate listener registrations;
- a subscriber invalidated by a new `ctx.on()` can refresh after the scheduled notification and see the newly registered listener;
- the registry does not change event dispatch results or listener execution order.

### 5. Keep the first feature intentionally host-first

Out of scope for this proposal:

- Web UI;
- static event mode inference;
- per-listener timing;
- `next()` tracing or short-circuit attribution;
- raw event argument capture;
- persistent listener ids;
- declaration-time discovery of events that have no live listeners;
- historical registry storage beyond the existing bounded dispatch timeline.

## Alternatives considered

**Do not add `EventSnapshot`; let every client group `listeners` itself.** Rejected because the first product feature is specifically an Event / Listener Registry. Defining the event-level projection once in the shared contract prevents the future Web UI, CLI, and exporters from inventing subtly different rules for which events exist and how listener order is represented.

**Add a single `mode` field to `EventSnapshot`.** Rejected because Cordis chooses dispatch mode per invocation. The same event name can technically be dispatched through different methods, and an event may not have been dispatched since observation began. Reporting one mode would manufacture a static fact that Cordis does not provide.

**Build the registry incrementally from `internal/listener` events instead of reading `_hooks`.** Rejected because `internal/listener` is a pre-registration interception point, does not provide a symmetric unregister event, and cannot reconstruct listeners registered before DevTools starts. Live `_hooks` is the stronger source of truth for observer mode.

**Wrap `ctx.on()`, EventService registration, or unregister paths to get perfect add/remove callbacks.** Rejected for observer mode because that changes the mechanism being inspected and expands the compatibility surface. Instrumentation or upstream diagnostic hooks can be reconsidered only if the live-snapshot approach proves insufficient.

**Start with the Web UI and derive registry semantics inside React.** Rejected because collection semantics and presentation should remain separated. The host/shared contract needs to be proven first so UI work becomes rendering rather than runtime reverse engineering.

## Acceptance criteria

- `DevtoolsSnapshot` exposes an explicit event registry derived from current live listeners.
- Event listener ids are listed in the exact current Cordis hook order.
- `ListenerSnapshot` ownership, order, `prepend`, and `global` values are proven against real Cordis runtime behavior.
- Listener ids are unique per live registration and stable across repeated snapshots for that registration, without promising persistence across reload/disposal.
- Plugin disposal removes its listeners; plugin restart/reload does not create duplicate live registrations.
- Subscriber invalidation for a newly registered listener occurs after normal registration has completed, so the resulting refresh observes the new hook.
- No event-level `mode` field is added; dispatch mode remains an observed dispatch fact.
- Observer mode does not wrap target listeners, replace dispatch methods, alter arguments, or reorder callbacks.
- No raw event payload is captured.
- Real Cordis integration tests, type checking, repository policy checks, and build all pass.

## Risks

- `_hooks` is an internal Cordis field. Its shape can change between Cordis releases; all knowledge of that shape must remain isolated in the adapter and be protected by integration tests against the installed dependency.
- Event snapshots only describe events with live listeners. Cordis does not expose a declaration registry for all possible event names, so an event with zero listeners is intentionally absent even if TypeScript declarations exist elsewhere.
- Microtask invalidation means notifications are refresh signals, not a lossless audit log of registration operations. Multiple registrations in one synchronous turn may intentionally coalesce into one refresh.
- Fiber lifecycle transitions can expose intermediate states such as unloading while a listener is still physically registered. The live snapshot should report the runtime as it actually exists at the moment of capture rather than hiding those states.
- Listener ids are diagnostic runtime identities only. Consumers must not persist them or treat them as stable across plugin restart, disposal, or process restart.
