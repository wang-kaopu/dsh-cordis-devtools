# Agent Note: Cross-view navigation

Status: proposed

## Problem

Events, Timeline, and Fibers expose related Cordis facts but currently behave as isolated views. A user must manually copy a fiber name/uid or event name into another view to continue diagnosis.

## Decision

Add presentation-only navigation inside the existing DevTools shell:

- a live listener owner in Events can open its current Fiber;
- a Timeline dispatch context can open its Fiber only when that uid still exists in the live Fiber snapshot;
- Fibers exposes the currently owned live event names as navigation targets back to Events.

Navigation reuses the existing shell state. It clears the search query and, when opening a Fiber, resets the lifecycle-state filter so the requested live Fiber cannot remain hidden by presentation filters.

Historical dispatch references that no longer resolve to a live Fiber remain visible as historical metadata and are labeled as not live; no synthetic Fiber is created.

## UI boundary

Use existing DSH `Pill` interaction where a compact relationship link is useful. Do not add a router, new top-level view, new Host API, new store, or new poller.

## Regression guard

The earlier Fiber Inspector footer implementation note was intentionally removed from the visible UI. The O1 view split accidentally restored it; this task removes that regressed explanatory footer again without changing Fiber snapshot semantics.

## Verification

- component test covers Events owner → Fiber;
- component test covers Timeline context → Fiber;
- component test covers Fiber owned event → Events;
- component test covers historical/live-missing Timeline fiber as non-navigable;
- existing one-poller, stale snapshot, filtering, build, and real-Web integration behavior remains intact.
