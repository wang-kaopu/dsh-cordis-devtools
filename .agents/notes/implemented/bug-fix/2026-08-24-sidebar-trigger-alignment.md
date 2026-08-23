# Agent Note: Align the sidebar footer trigger and update tsdown dependency config

Status: implemented

## Problem

The Cordis DevTools footer trigger did not follow the same 42px wide-row / 36px rail-control geometry as the DSH Settings footer entry, so its position and visual rhythm differed from the surrounding native sidebar chrome. The tsdown build also still used the deprecated `external` option and emitted a warning on every build.

## Decision

Keep the existing Cordis DevTools slot and icon, but align the trigger geometry with the DSH sidebar footer conventions: a 42px wide row with matching horizontal padding, margin, radius, and hover fill, plus a 36x36 collapsed rail control.

Migrate both Host and Client external dependency declarations from `external` to `deps.neverBundle` without changing which packages are externalized. Do not change the TypeScript version or declaration-generation strategy in this change.

## Alternatives considered

**Move or modify the Settings slot itself.** Rejected because the sidebar shell already defines `sidebar.footer.action` above `sidebar.settings`; the plugin should align its own occupant instead of mutating another package's slot.

**Change the Cordis icon in the same patch.** Deferred because the existing `IconCordisPluginOutline14` is a DSH primitive and is also used by DSH's own `ui-cordis`; icon selection is separate from layout alignment.

**Change TypeScript 7 to remove its experimental warning.** Rejected for this patch because the requested build cleanup is limited to the deprecated tsdown option.

## Consequences

The footer entry now follows the same sidebar rhythm as Settings while keeping the existing panel behavior and slot placement. Builds no longer emit the tsdown `external` deprecation warning; the TypeScript 7 experimental warning intentionally remains.
