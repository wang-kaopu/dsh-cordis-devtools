# Parallel Development Plan

This document converts the roadmap into merge-safe work packages. Parallel work is encouraged only when dependencies and file ownership are clear; two agents editing the same shared contract or monolithic UI file is not useful parallelism.

See [Roadmap to v0.3](roadmap.md) for milestone semantics and exit criteria.

## Rules for parallel work

1. **Parallelize independent evidence or layers, not unresolved decisions.** Decision-sensitive architecture checkpoints remain serial.
2. **Freeze shared contracts before parallel consumers depend on them.** Do not let Host and UI branches independently invent trace fields.
3. **Prefer disjoint file ownership.** If two tasks both need the same shared type or shell component, sequence them or stack one branch on the other.
4. **Do not weaken gates to make branches easier to merge.** Each PR must pass policy, typecheck, tests, build, and relevant integration checks.
5. **Keep Agent Notes with the owning decision.** A dependent PR links the owning Note rather than copying its rationale.
6. **Rebase/refresh after prerequisites merge.** A branch that was parallel-safe at creation may become stale after a shared-contract change.

## Task catalog

| ID | Task | Primary area | Depends on | Parallel notes |
| --- | --- | --- | --- | --- |
| O1 | Split Web views into stable files | client structure | none | Can run beside O4; should land before multiple UI feature branches |
| O2 | Cross-view navigation | client shell/views | O1 | Can run beside O3-host and O4; may conflict with O3-UI |
| O3-H | Fiber Effects Host/shared model | adapter/shared/tests | none | Safe beside O1/O2/O4 because it should avoid client view files |
| O3-U | Fiber Effects UI | Fibers view | O1 + O3-H | Sequence after O2 if both touch Fibers navigation/detail heavily |
| O4 | Minimal real DSH Web E2E harness | tests/scripts/CI | none | Best independent parallel lane during all observer UI work |
| O5 | v0.2 release hardening | docs/release checks | O2 + O3 + O4 | Serial milestone close |
| I0 | v0.3 instrumentation architecture | architecture/Note | v0.2 direction stable | Serial hard checkpoint; no production wrapping before approval |
| I1 | Waterfall trace contract + behavior fixtures | shared/tests | I0 | Contract freezes before UI/storage consumers |
| I2 | Instrumentation core | Host adapter/tests | I0 + I1 | Main critical path |
| I3 | Parity/overhead harness | tests/bench | I0 | Harness scaffolding can run beside I1/I2; final assertions depend on I2 |
| I4 | Bounded trace storage/transport | collector/RPC/shared | I1 + enough of I2 | Avoid parallel edits to the same trace contract |
| I5 | Profiler UI | client | I1 contract stable + I4 read path | Can run beside late I2/I3 once contract/read path are stable |
| I6 | v0.3 integration hardening | E2E/docs | I2 + I3 + I4 + I5 | Serial milestone close |

## Recommended execution waves

### Wave A — prepare v0.2 for parallel work

Run in parallel:

```text
Lane A1: O1 — split client views
Lane A2: O4 — minimal real DSH Web E2E harness
Lane A3: O3-H — Fiber Effects Host/shared model
```

Why this is safe:

- O1 owns client source organization;
- O4 primarily owns integration harness/scripts/workflow glue;
- O3-H owns Host adapter/shared snapshot/runtime tests.

The three branches should not need to edit the same functional code if scoped correctly.

### Wave B — connect observer UX

After O1 merges:

```text
Lane B1: O2 — cross-view navigation
Lane B2: continue/finish O4 — real browser scenarios
```

O3-H may still be running independently.

Do **not** start O3-U in parallel with a large O2 change to `FibersView` unless the branches have explicit file partitioning. The cheaper plan is usually:

```text
O2 merge
  ↓
O3-U rebase
  ↓
add Effects UI on the stable navigation shell
```

### Wave C — close v0.2

```text
O3-U
  +
O4 final Effects/cross-nav browser smoke
  ↓
O5 release hardening
```

At this point observer mode should be treated as a stable baseline for v0.3 parity tests.

### Wave D — v0.3 architecture and evidence

Serial first:

```text
I0 — architecture proposal/checkpoint
```

Only after approval, run in parallel where useful:

```text
Lane D1: I1 — trace contract + waterfall behavior matrix
Lane D2: I3 — parity/overhead harness scaffolding
```

I1 is authoritative for trace field names and semantics. I3 may build harness machinery in parallel, but it must not invent a competing trace contract.

### Wave E — v0.3 implementation

Critical path:

```text
I1
 ↓
I2 instrumentation core
 ↓
I4 bounded storage/read path
 ↓
I5 profiler UI
```

Useful controlled parallelism:

- I3 can run beside I2 and become a regression harness as instrumentation stabilizes.
- I5 can begin against frozen I1 fixtures once the read interface from I4 is stable enough, but should not guess transport details.
- Documentation/privacy wording can be prepared beside implementation, but must be reconciled with measured behavior before merge.

### Wave F — v0.3 close

```text
I2 + I3 + I4 + I5
        ↓
I6 real DSH Web integration hardening
        ↓
v0.3
```

## Dependency graph

```text
                         ┌──────── O4 E2E ───────────────┐
                         │                               │
O1 view split ──► O2 cross-nav ───────────────┐         │
      │                                       │         │
      └──────────────► O3-U Effects UI ◄── O3-H         │
                                              │         │
                                              └──► O5 ◄─┘
                                                   │
                                                   ▼
                                              v0.2 stable
                                                   │
                                                   ▼
                                                  I0
                                                   │
                               ┌───────────────────┴──────────────┐
                               ▼                                  ▼
                         I1 trace contract                  I3 harness
                               │                                  │
                               ▼                                  │
                         I2 instrumentation ◄─────────────────────┘
                               │
                               ▼
                         I4 storage/read path
                               │
                               ▼
                         I5 profiler UI
                               │
                               ▼
                         I6 integration
                               │
                               ▼
                              v0.3
```

## Suggested branch ownership

Keep branch names narrow and make ownership visible:

```text
refactor/client-view-split       # O1
feat/cross-navigation            # O2
feat/fiber-effects-host          # O3-H
feat/fiber-effects-ui            # O3-U
test/dsh-web-e2e                 # O4

architecture/waterfall-profiler  # I0 design-only
feat/waterfall-trace-contract    # I1
feat/waterfall-instrumentation   # I2
test/instrumentation-parity      # I3
feat/profiler-trace-storage      # I4
feat/waterfall-profiler-ui       # I5
```

These are suggestions, not a requirement to create every branch in advance.

## High-conflict surfaces

Treat these as serialized ownership unless a prerequisite refactor creates clean seams:

### `src/shared/types.ts`

Any change here is a contract decision. One owning PR should freeze fields before other branches consume them.

### `src/client/EventExplorer.tsx` / future shell

Until O1 lands, UI work is merge-conflict-heavy. Do not run Effects UI and cross-navigation as independent edits to the same monolith.

### `src/host/cordis-adapter.ts`

This is the compatibility boundary for Cordis internals. Observer Effects work and v0.3 instrumentation should not be developed concurrently against different assumptions on the same branch base.

### `src/host/collector.ts`

Trace retention and current observer dispatch retention must stay semantically distinct. I4 owns any new instrumented trace state.

## What can start immediately after this planning PR

The safest three-way parallel start is:

```text
Agent/branch A: O1 client view split
Agent/branch B: O3-H Fiber Effects Host/shared snapshot
Agent/branch C: O4 real DSH Web E2E harness
```

After O1 lands, O2 cross-navigation can start. O3-U should wait for both O1 and enough of O3-H to define the Effect snapshot, and preferably for O2 to stabilize Fibers navigation.

v0.3 production instrumentation should **not** start in parallel with those tasks. Research and test-case cataloging are fine, but I0 remains the hard architecture checkpoint.
