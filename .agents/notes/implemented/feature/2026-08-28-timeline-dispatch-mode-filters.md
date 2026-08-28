# Agent Note: Timeline always exposes Cordis dispatch modes

Status: implemented

## Problem

The Timeline mode filter previously derived its labels only from retained dispatch records. If the bounded history had no record for a standard Cordis dispatch mode, that mode could not be selected and the panel could not show the resulting empty state.

## Decision

The client Timeline filter always renders Cordis's standard `emit`, `parallel`, `serial`, `bail`, and `waterfall` modes. It also appends any additional mode values observed in runtime dispatch records. Filtering remains unchanged, so selecting a mode with no matching records keeps the filter bar available and renders the existing empty-list message.

## Alternatives considered

### Derive labels only from retained dispatch records

Rejected because it hides valid standard filters precisely when their result set is empty.

### Add a separate empty-state control for missing modes

Rejected because it duplicates the existing mode filter and would make empty-result behavior inconsistent with normal filtering.

## Consequences

Users can inspect every standard Cordis dispatch mode even when the bounded history currently contains no dispatch for that mode. Runtime extensions remain selectable, while ordering, search, dispatch details, and the metadata-only observer contract are unchanged.
