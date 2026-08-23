# Agent Note: Expose live Fiber effect metadata in Host snapshots

Status: implemented

## Problem

The Fibers view can identify live plugin instances, parentage, inject names, and listener ownership, but it cannot inspect the lifecycle registrations that Cordis already exposes through `fiber.getEffects()`. Reconstructing effects from listener/service registries would be incomplete and would invent relationships Cordis did not report.

## Decision

Add `EffectSnapshot { label, children }` to the serializable shared model and include `effects: EffectSnapshot[]` on every `LiveFiberSnapshot`.

`CordisAdapter.snapshotFibers()` calls the public diagnostic `fiber.getEffects()` API for each current live registry fiber and recursively projects only its label/tree metadata. No disposer functions, plugin config, captured arguments, stack traces, intercept values, or historical effect state are collected.

The field belongs only to live Fiber inventory. Historical `DispatchRecord.thisFiber` remains a compact `FiberSnapshot` and does not retain effects after disposal.

## Alternatives considered

- Reconstruct effects from listener and service registries. Rejected because it loses custom/nested effects and would present inference as authoritative lifecycle state.
- Expose raw Cordis `EffectMeta` objects directly. Rejected because the shared transport contract should stay serializable and independent of Host runtime object identity.
- Add Effects only in the browser by querying another RPC. Rejected because the existing snapshot already owns live Fiber facts and another source of truth is unnecessary.

## Consequences

Host/shared now has the authoritative data needed for the later Fiber Effects UI without adding a new transport or poller. Snapshot size grows with labeled live effect metadata, but remains metadata-only and bounded by the current live registry/effect trees rather than a retained history.
