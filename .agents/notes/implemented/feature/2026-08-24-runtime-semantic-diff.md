# Agent Note: Runtime semantic diff

Status: implemented

## Problem

A before/after verifier cannot compare runtime-local listener ids or Fiber uids across reloads. It also cannot collapse duplicate equal-looking Fibers/listeners into sets, because the primary v0.5 regression is a multiplicity change from two live instances to one.

## Decision

Add a pure semantic diff engine over two `RuntimeCheckpoint` values with the same schema and scope.

Listeners are grouped by event, owner name, order, prepend, and global flags. Fibers are grouped by name, normalized state, parent name, sorted inject names, sorted owned event names, and canonical metadata-only Effect trees. Runtime-local ids/uids are deliberately excluded from these descriptors.

Descriptors are compared as multisets. The result includes only changed event/listener/Fiber groups and explicit before/after counts plus delta. Exact checkpoint digest churn does not make `changed=true` by itself.

The engine rejects unsupported schema versions and scope mismatch instead of comparing unlike checkpoint meanings.

## Alternatives considered

- Compare checkpoint JSON or digest directly. Rejected because reload-induced id/uid churn would create false semantic changes.
- Compare descriptors as sets. Rejected because duplicate multiplicity such as `2 -> 1` would disappear.
- Pair individual Fibers/listeners heuristically across checkpoints. Rejected because no stable runtime identity exists across reload and heuristic pairing would fabricate certainty.

## Consequences

The diff can report duplicate runtime topology changes without treating runtime-local identity churn as meaningful. It remains a factual comparison layer and does not emit `fixed`, root-cause, or confidence claims. Digest validation/integrity and live current capture remain responsibilities of the checkpoint/query integration workstreams.
