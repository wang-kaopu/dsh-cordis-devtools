# Agent Note: Waterfall experiment coordinator ownership

Status: implemented

## Problem

The existing waterfall controller exposes raw `enable()` / `disable()` mutation. v0.6 needs one higher-level owner so Human profiling, DSH Agent leases, MCP Agent leases, timeout cleanup, and plugin disposal cannot independently toggle the same dispatch seam.

## Decision

`WaterfallExperimentCoordinator` is the owner-state machine above the existing low-level controller.

It provides:

- one owner slot: none, Human, or one Agent lease;
- Agent start with a positive finite TTL bounded by the configured/default maximum;
- exact-lease Agent stop;
- expiry cleanup that rechecks the lease id before disabling;
- Human acquire/release plus an explicit Human force-stop safety action;
- factual status that always includes the low-level controller state;
- disposal cleanup;
- `currentExperimentId()` for the later trace-tagging integration.

A second start is `busy` and never calls the controller. Unsupported/conflict controller states propagate without optimistic ownership. Stop/expiry never force-restore a conflicting dispatch seam; logical ownership is released rather than claiming the coordinator still controls a seam it no longer owns.

## Alternatives considered

### Let each adapter maintain its own lease/timer

Rejected. Independent Human/DSH/MCP state can race and a stale adapter timer could disable a newer owner.

### Make raw controller enable/disable itself understand Agent identity and approval

Rejected. The controller is the Cordis compatibility seam and should remain transport/authority agnostic. Approval, auth, and user presentation belong above it.

### Permit Agent takeover of a Human session

Rejected. Start returns `busy`; Human ownership can only change through Human control. Conversely, the Human safety surface has an explicit force-stop for an Agent-owned lease.

### Renew an existing Agent lease

Rejected for v0.6. Every lease has one fixed finite expiry; renewal would add a new stale-owner race and authority path.

## Consequences

The later service integration must route every production instrumentation mutation through this coordinator and stop exposing direct controller mutation to browser/Agent adapters. Trace tagging may query the coordinator's current experiment id, but the coordinator does not own or mutate trace storage.

Fake-timer tests pin exact-lease cleanup, stale timeout safety, Human ownership, busy behavior, TTL validation, and fail-closed conflict handling before production adapters are wired.
