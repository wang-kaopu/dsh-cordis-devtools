# Agent Note: Cross-view navigation

Status: implemented

## Problem

Events, Timeline, and Fibers expose related Cordis facts but previously behaved as isolated views. A user had to manually copy a fiber name/uid or event name into another view to continue diagnosis.

## Decision

Add presentation-only navigation inside the existing DevTools shell:

- a live listener owner in Events opens its current Fiber;
- a Timeline dispatch context opens its Fiber only when that uid still exists in the live Fiber snapshot;
- Fibers exposes currently owned live event names as navigation targets back to Events.

Navigation reuses the existing shell state. It clears the search query and, when opening a Fiber, resets the lifecycle-state filter so the requested live Fiber cannot remain hidden by presentation filters.

Historical dispatch references that no longer resolve to a live Fiber remain visible as historical metadata and are labeled `not live`; no synthetic Fiber is created.

## Alternatives considered

- Add a routing library or URL-addressable internal routes. Rejected because the panel already owns all three views and cross-navigation is transient presentation state.
- Resolve historical dispatch fiber references through a second retained Fiber registry. Rejected because it would blur authoritative live state with history and duplicate Host state.
- Make every historical fiber reference clickable and synthesize a detail page when live state is missing. Rejected because that would present stale metadata as if it were a current Fiber.
- Use custom text-link controls for the relationship edges. Rejected where DSH `Pill` already provides a compact, semantically appropriate interaction.

## UI boundary

Existing DSH `Pill` interactions are reused for compact relationship links. No router, new top-level view, Host API, store, or poller was introduced.

## Cleanup

The Fiber Inspector explanatory footer had already been intentionally removed from the visible UI. The O1 split retained dead hidden markup for that copy; this task removes the stale JSX so a later CSS change cannot accidentally reveal it again.

## Consequences

The three existing views now form a diagnostic loop without changing the observer data model. Navigation is intentionally lossy when a historical Timeline record references a Fiber that has since disappeared: the historical context remains readable but is not navigable. Clearing search and Fiber-state filters on relationship navigation prioritizes reaching the explicit target over preserving unrelated presentation filters.

## Verification

- component test covers Events owner → Fiber;
- component test covers Timeline context → Fiber;
- component test covers Fiber owned event → Events;
- component test covers historical/live-missing Timeline fiber as non-navigable;
- one snapshot poller remains true across navigation;
- stale snapshot and existing filtering behavior remain covered;
- full repository CI and real DSH Web E2E are required before merge.
