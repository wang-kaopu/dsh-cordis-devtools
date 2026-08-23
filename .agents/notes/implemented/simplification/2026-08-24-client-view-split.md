# Agent Note: Split the Web DevTools views into stable files

Status: implemented

## Problem

`src/client/EventExplorer.tsx` owned the sidebar trigger, shared panel state, filtering, Events rendering, Timeline rendering, and Fibers rendering in one file. The behavior worked, but unrelated UI tasks had to edit the same large component, making the planned cross-navigation and Fiber Effects UI unnecessarily conflict-prone.

## Decision

Keep shared panel lifecycle and presentation state in `src/client/DevtoolsShell.tsx`, and move the three existing views into `src/client/views/EventsView.tsx`, `TimelineView.tsx`, and `FibersView.tsx`.

`src/client/EventExplorer.tsx` remains as a compatibility re-export so the client plugin entry and existing tests keep the same import boundary. The split does not add routing, another store, another poller, or new Host/shared behavior.

## Alternatives considered

- Keep the monolithic component and accept merge conflicts. Rejected because the roadmap intentionally introduces multiple independent UI tasks.
- Add a router or global client navigation store while splitting. Rejected because O1 is behavior-preserving structure work; navigation semantics belong to O2.
- Move filters and selection state into each view. Rejected because those are shared shell/navigation concerns and would create duplicate state sources.

## Consequences

View-specific JSX and helpers now have stable file ownership while one sidebar contribution, one snapshot store, one poller, and the existing selectors remain unchanged. Future UI work can target a view file without editing the entire DevTools surface.
