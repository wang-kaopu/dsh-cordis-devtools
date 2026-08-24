# Agent Note: Exclude capture-local listener order from semantic identity

Status: implemented

## Problem

The first v0.5 listener semantic descriptor included the observer's runtime registration `order`. Real DSH verification showed that two otherwise equivalent duplicate listeners necessarily occupy different order positions. That split the duplicates into separate semantic groups, so a real duplicate topology could not produce the intended multiplicity change `2 -> 1` even though the event count and Fiber group did.

This contradicts the approved v0.5 requirement that duplicate equivalent registrations be preserved as multiset counts across checkpoints.

## Decision

Keep `order` in `RuntimeCheckpointListener` as capture-local evidence for one snapshot, but remove it from `RuntimeListenerSemanticDescriptor` and therefore from the cross-checkpoint grouping key.

The stable listener semantic key is now:

- event name;
- owner Fiber name or no owner;
- prepend flag;
- global flag.

Runtime-local listener id, owner uid, and registration order are all excluded from cross-checkpoint identity. Focused tests use duplicate listeners with different order values and require one semantic group with multiplicity `2 -> 1`.

## Alternatives considered

- Relax the final real-DSH E2E to accept separate `1 -> 0` listener rows. Rejected because it would preserve an implementation artifact while violating the product contract for duplicate multiplicity.
- Normalize order by relative rank inside each owner/event group. Rejected because rank still changes when one duplicate disappears and adds complexity without stable identity semantics.
- Remove order from checkpoints entirely. Rejected because order remains useful evidence within one capture and for human/Agent inspection; only cross-checkpoint identity is unstable.

## Consequences

Real duplicate listeners with the same stable metadata can now compare as one multiset group and report `2 -> 1`. Checkpoints still retain exact registration order for capture-local inspection and digest integrity. The v0.5 semantic descriptor public type no longer exposes `order`; this correction lands before v0.5 repository closeout/version `0.5.0`.
