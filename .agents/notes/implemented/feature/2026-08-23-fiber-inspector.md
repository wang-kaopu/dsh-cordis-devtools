# Agent Note: Add the Fiber Inspector

Status: implemented

## Problem

The Web DevTools exposed Events and a recent Dispatch Timeline but not the live Cordis plugin fibers that own listeners and appear as dispatch contexts. The existing `DevtoolsSnapshot.fibers` field was also opportunistic observation history rather than authoritative live inventory, so it could miss quiet pre-existing plugins and retain disposed fibers. Compact fiber references additionally rendered Cordis numeric lifecycle states directly.

## Decision

`DevtoolsSnapshot.fibers` is now an authoritative live registry snapshot sourced from `ctx.registry.values()` and each runtime's live `fibers`. `CordisAdapter` owns that enumeration and excludes null-uid disposal entries. The collector no longer maintains a second `observedFibers` history.

`FiberSnapshot` remains the compact reference type for listener owners and historical dispatch contexts. `LiveFiberSnapshot` represents current registry membership with a non-null uid plus normalized lifecycle state, compact parent metadata, and declared inject service names. Known numeric Cordis states are normalized at the adapter boundary to `pending`, `loading`, `active`, `failed`, `disposed`, and `unloading`; unknown future values remain strings.

`internal/plugin` invalidation is deferred/coalesced so subscriber refreshes observe the settled registry after Cordis' create/dispose turn. Listener invalidation keeps its existing defer because `internal/listener` fires before hook insertion.

The existing single Web DevTools shell now contains a third `Fibers` view beside Events and Timeline. It reuses the same snapshot store and visible-only silent poller, supports name/uid search and live-state filters, and shows selected-fiber uid/state/parent/inject metadata. Owned listener/event counts are derived from current listener ownership by uid. `recent dispatch-context hits` is derived only from the bounded Timeline window and is explicitly not a lifetime execution count.

The UI continues to reuse DSH primitives for shared interaction semantics and uses layer backgrounds, spacing, and selection state before separators or high-contrast borders.

## Alternatives considered

**Render the old `observedFibers` map.** Rejected because it was neither complete nor live and would turn an implementation convenience into false observability.

**Keep the old map but label it “Observed Fibers.”** Rejected because Cordis already exposes a public authoritative registry, so known incompleteness would provide less useful diagnostics without a meaningful compatibility benefit.

**Add effect trees immediately.** Deferred because effect metadata substantially increases information density and shared-contract size; correct live inventory is the smaller first step.

**Expose plugin config/intercept values.** Rejected because it increases sensitivity risk and is unnecessary for lifecycle/ownership diagnosis.

**Add restart/dispose controls.** Rejected because the current browser channel is deliberately read-only; mutation requires separate authority, confirmation, and failure semantics.

**Build a topology graph.** Rejected because it is separate information architecture and overlaps ecosystem tooling. The inspector exposes only the selected fiber's parent relation.

## Consequences

Quiet plugins that predate DevTools now appear in the Fiber Inspector, multiple mounts remain distinct by uid, and disposed fibers disappear from the next live snapshot. Events and Timeline also gain readable fiber lifecycle labels through the shared adapter normalization.

The live `fibers` collection and historical `DispatchRecord.thisFiber` references intentionally have different retention semantics: a dispatch may still reference a fiber that is no longer present in live inventory.

No new RPC channel, Host history, browser database, poller, config capture, effect capture, topology model, or mutation endpoint was introduced. Real Cordis integration tests cover live registry membership, multi-mount behavior, pending/inject metadata, disposal, and state normalization; client tests cover Fibers view switching, search, state filters, derived counts, and reuse of the existing poller.
