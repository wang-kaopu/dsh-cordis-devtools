# Agent Note: Refine DevTools chrome after real DSH smoke testing

Status: implemented

## Problem

A real DSH Web smoke test exposed two presentation problems that source-level and jsdom tests did not reveal. The DevTools panel used too many high-contrast borders, making the floating surface look visually separate from the surrounding DSH UI. The one-second snapshot poll also toggled the shared `loading` state on every request, causing the visible Refresh control to change state once per second.

## Decision

Remove non-essential panel, toolbar, list-split, listener-card, and timeline-card borders. Surface hierarchy is expressed primarily through DSH background tokens, spacing, selected states, radius, and the existing floating shadow. Separators should only be introduced later where the information hierarchy cannot remain clear without them.

Keep manual and initial refreshes observable through `loading`, but make periodic polling a silent background refresh. Background refreshes still publish new snapshots and stale/error state, but they do not publish `loading: true`. The Refresh button keeps a stable `Refresh` label so polling cannot cause width or text jitter.

## Alternatives considered

**Keep all separators and only lower their opacity.** Rejected because the real UI showed that most separators were unnecessary, not merely too bright.

**Remove polling and require manual refresh.** Rejected because recent registry/timeline data should continue updating while the panel is open.

**Hide every refresh state, including manual refresh.** Rejected because explicit user actions should still provide busy-state protection and avoid duplicate requests.

## Consequences

The Web surface relies more strongly on DSH-provided layer tokens and component states instead of local outlines. Background polling becomes visually silent while preserving the existing one-second snapshot semantics, stale/error reporting, request de-duplication, and close-time cancellation.
