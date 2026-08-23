# Agent Note: Cross-navigation auto scroll

Status: implemented

## Problem

Cross-view navigation correctly selects the target Event/Fiber, but the corresponding left-side list does not ensure the selected row is visible. When the target is outside the current scroll viewport, the detail pane changes while the highlighted list row remains off-screen.

## Decision

EventsView and FibersView keep refs to their own scrollable list containers. After the active selection changes, each view finds the matching rendered row and calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` when the browser provides the API.

The behavior is tied to active selection rather than to a special cross-navigation code path, so manual selection, filtering fallback, and cross-view navigation share one rule. `nearest` avoids unnecessary movement when the row is already visible and does not introduce smooth scrolling.

## Alternatives considered

- Scroll from DevtoolsShell only for cross-navigation callbacks. Rejected because it couples shell navigation to child DOM structure and misses other selection changes.
- Use fixed scroll offsets/index arithmetic. Rejected because row height and responsive layout are presentation details already known by the browser.
- Always center the target row. Rejected because it causes more movement than necessary; `nearest` is less disruptive.

## Consequences

Cross-navigation now keeps the selected Event/Fiber visible in its left list without adding routing state, timers, or layout assumptions. The change is browser-presentation-only and does not affect Host/runtime semantics.
