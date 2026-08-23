# Agent Note: Add the Fiber Inspector

Status: proposed

## Problem

The Web DevTools already exposes Events and a recent Dispatch Timeline, but it does not expose the Cordis plugin fibers that own listeners and dispatch contexts. The current `DevtoolsSnapshot.fibers` field is also not an authoritative live inventory: `ObserverCollector` accumulates fibers opportunistically from listener owners, dispatch contexts, and future `internal/plugin` / `internal/status` notifications. A plugin that existed before DevTools started and owns no listener can therefore be absent, while a fiber seen earlier can remain in the map after disposal.

The existing compact fiber references also stringify Cordis' numeric `FiberState` directly, so real DSH Web currently renders values such as `uid 125 · 2` instead of a meaningful lifecycle label.

Cordis already exposes a public authoritative registry path. `ctx.registry.values()` returns registered plugin runtimes and each runtime owns its current live `fibers`. DeepSeek Harness' own `cordis_runtime_inspect` uses this path when it describes loaded plugins.

## Proposal

Replace `ObserverCollector`'s accumulated `observedFibers` inventory with a live registry snapshot produced by `CordisAdapter`. The adapter will enumerate `ctx.registry.values()` and each runtime's live fibers, excluding fibers whose `uid` has already become `null` during disposal. `DevtoolsSnapshot.fibers` will therefore mean **live plugin fibers currently known to this Cordis registry**, not historical fibers observed by DevTools.

Keep compact fiber references for listener ownership and historical dispatch context, but introduce a richer live-fiber record for the registry inventory. The first live record should contain only metadata Cordis exposes directly and that is useful without capturing plugin configuration:

- `uid`;
- `name`;
- normalized lifecycle `state`;
- compact `parent` fiber reference;
- required service names from `Object.keys(fiber.inject)`.

Do not include raw plugin config, intercept config values, effect trees, service-provider graphs, stacks, errors, or mutation methods in this version.

Normalize known Cordis numeric lifecycle states at the adapter boundary to readable values: `pending`, `loading`, `active`, `failed`, `disposed`, and `unloading`. Unknown future values remain representable as strings rather than being guessed. The same compact normalization applies to listener owners and dispatch-context references, so Events and Timeline stop rendering raw state numbers as a side effect of this change.

Because Cordis emits the disposal form of `internal/plugin` after clearing `fiber.uid` but before removing the fiber from `runtime.fibers`, registry invalidation must not invite an immediate subscriber snapshot of that transient state. Coalesce/defer plugin-registry invalidation until the current turn completes, analogous to the existing listener-registry invalidation seam.

Add a third `Fibers` view to the existing single `sidebar.footer.action` DevTools shell. Reuse DSH UI primitives for shared controls and interaction semantics. Continue the current visual rule from the real DSH smoke feedback: use spacing, layer backgrounds, selection state, and DSH tokens first; introduce separators only where they are necessary for comprehension.

The first Fiber Inspector should provide:

- live fiber list, sorted deterministically by uid;
- search by fiber name or uid;
- lifecycle-state filters derived from states present in the current snapshot;
- selected fiber detail showing uid, state, parent, and injected service names;
- owned listener count and distinct owned event count derived client-side from the existing listener snapshot by matching owner uid;
- recent dispatch-context hit count derived client-side from the current bounded `dispatches` window by matching `thisFiber.uid`.

The UI must label the dispatch-derived count as **recent dispatch-context hits** rather than total executions, and it must not treat a dispatch context fiber as the owner of every listener involved in that dispatch.

No new RPC channel, polling loop, Host history, or browser-side database is introduced. Events, Timeline, and Fibers continue to share one read-only snapshot store and one visible-only silent poller.

## Alternatives considered

**Render the existing `observedFibers` map as the Fiber Inspector.** Rejected because it is neither complete nor live. Presenting it as the plugin inventory would turn an implementation convenience into false observability.

**Keep `observedFibers` but label the view “Observed Fibers.”** Rejected as the default because Cordis already exposes a public authoritative live registry, so accepting known incompleteness would provide less useful diagnostics without reducing compatibility risk meaningfully.

**Add effect trees from `fiber.getEffects()` in the first version.** Deferred. Effects are useful diagnostics, but they substantially increase information density and shared-contract size. The first inspector should establish correct live inventory and ownership/navigation semantics before adding a separate effect-detail surface.

**Expose plugin config and intercept configuration.** Rejected for this observer-first version because it increases privacy/sensitivity risk and is unnecessary for identifying lifecycle and ownership problems.

**Add restart/dispose controls.** Rejected because the current Web channel is deliberately read-only. Runtime mutation needs a separate contract, authority, confirmation UX, and failure semantics.

**Build a parent/child topology graph.** Rejected for this feature because a topology visualization is a separate information architecture and overlaps existing ecosystem tooling. The inspector only exposes the selected fiber's parent relation.

## Acceptance criteria

- A real Cordis plugin created before DevTools, with no event listeners and no dispatch activity, still appears in `snapshot().fibers` because it exists in `ctx.registry`.
- Two mounts of the same plugin appear as two live fiber records with distinct uids.
- Disposing a plugin removes it from the next authoritative live snapshot; a subscriber refreshing after the deferred invalidation does not receive a stale disposed registry entry.
- Known numeric Cordis states render as readable lifecycle labels in Fibers, listener owners, and dispatch contexts.
- Parent metadata and inject names come from the live Cordis fiber without exposing config values.
- The Web shell gains exactly one `Fibers` view and does not start another polling loop or add another sidebar action.
- Fiber search and state filters work against the latest snapshot.
- Owned listener/event counts are derived only from listener owners with the same uid.
- Recent dispatch-context hits are derived only from the bounded timeline and are explicitly labeled recent/bounded rather than lifetime totals.
- The Fiber view reuses DSH primitives when semantics match and does not reintroduce unnecessary high-contrast dividers or card borders.
- `pnpm verify:policy`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify:client-bundle` pass.
- A real DSH Web smoke confirms readable states, correct view switching, visual alignment, and stable silent polling.

## Risks

`ctx.registry.values()` and `runtime.fibers` are public Cordis APIs today, but the richer fiber record still becomes a shared observability contract that future changes must preserve or version deliberately.

A parent fiber can be the root fiber, which is not itself part of the plugin-runtime inventory; the UI must therefore present parent metadata without assuming every parent uid has a row in `snapshot.fibers`.

Historical `DispatchRecord.thisFiber` references may describe a fiber that is no longer live. The Timeline should keep that historical reference, while the Fibers view remains live-only; the two collections intentionally have different retention semantics.

The authoritative registry can change during plugin creation/disposal. Snapshotting and invalidation must avoid turning Cordis' publication/disposal ordering into transient false UI states.