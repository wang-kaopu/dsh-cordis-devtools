# Parallel Development Plan — historical v0.2/v0.3 execution record

> **Archived:** v0.2 and v0.3 work described here has been completed. This document is retained as a record of the dependency/parallelization strategy that was used; it is not the current backlog. See [Roadmap to v0.3](roadmap.md) for delivered milestone evidence.

The plan was built around one rule: parallelize independent evidence/layers, not unresolved contracts or two branches that fight over the same shared semantic surface.

## Rules that remain useful

1. **Resolve decision-sensitive architecture before parallel implementation.**
2. **Freeze shared contracts before multiple consumers depend on them.**
3. **Prefer disjoint file ownership to optimistic merge-conflict cleanup.**
4. **Do not weaken gates to make parallel branches easier to land.**
5. **Keep the owning Agent Note with the decision instead of duplicating rationale.**
6. **Refresh branch bases after prerequisite merges.**

## Completed task catalog

| ID | Task | Primary area | Dependency | Status |
| --- | --- | --- | --- | --- |
| O1 | Split Web views into stable files | client structure | none | ✓ |
| O2 | Cross-view navigation | client shell/views | O1 | ✓ |
| O3-H | Fiber Effects Host/shared model | adapter/shared/tests | none | ✓ |
| O3-U | Fiber Effects UI | Fibers view | O1 + O3-H + O2 | ✓ |
| O4 | Real DSH Web E2E harness | E2E/CI | none | ✓ |
| O5 | v0.2 release hardening | tests/docs/version | O2 + O3 + O4 | ✓ |
| I0 | Waterfall instrumentation architecture | architecture/Agent Note | v0.2 stable | ✓ |
| I1 | Trace contract + behavior matrix | shared/tests | I0 | ✓ |
| I2 | Opt-in instrumentation core | Host/tests | I0 + I1 | ✓ |
| I3 | Semantic parity + overhead harness | tests | I0 + I2 for final evidence | ✓ |
| I4 | Bounded trace storage/transport | Host/RPC/shared | I1 + I2 | ✓ |
| I5 | Profiler UI | client | I1 + I4 | ✓ |
| I6 | v0.3 integration/release hardening | E2E/docs/tests/version | I2 + I3 + I4 + I5 | ✓ |

## Waves that were used

### Wave A — observer foundations

```text
Lane A1: O1 client view split
Lane A2: O3-H Fiber Effects Host/shared
Lane A3: O4 real DSH Web E2E
```

These were intentionally disjoint: client organization, Host/shared Effects facts, and integration harness.

### Wave B — observer UX

```text
O1 merged
   ├─► O2 cross-navigation
   └─► O3-U after O2 stabilized Fibers detail/navigation
```

O3-U was sequenced behind O2 instead of independently editing `FibersView` at the same time.

### Wave C — v0.2 close

```text
O2 + O3 + O4
      ↓
     O5
      ↓
  v0.2 stable observer baseline
```

### Wave D — v0.3 contract/evidence

```text
I0 architecture checkpoint
        ↓ approved
   ┌────┴────┐
   ▼         ▼
  I1        I3 harness scaffolding
contract    / evidence infrastructure
```

I1 remained authoritative for trace field semantics. The harness did not invent a competing profiler contract.

### Wave E — v0.3 implementation

```text
I1 trace contract
      ↓
I2 instrumentation core ─────► I3 final paired parity
      ↓
I4 bounded storage / Host RPC
      ↓
I5 Profiler fixture UI + final client integration
```

In practice, I4 storage and I5 fixture/UI preparation could be developed in controlled parallel lanes after the shared trace contract was stable, then integrated through separate Host/client PRs.

### Wave F — v0.3 close

```text
I2 + I3 + I4 + I5
        ↓
I6 repository hardening
        ↓
0.3.0 repository-ready
```

I6 added no new profiler semantics; it synchronized version/docs/decision state and converted the full real DSH Web path into deterministic `enable → real waterfall trace → inspect → disable` evidence.

## Dependency graph

```text
O1 ──► O2 ───────────────┐
 │                       │
 └────► O3-U ◄── O3-H ───┤
                         ├──► O5 ──► v0.2 stable
O4 ──────────────────────┘              │
                                        ▼
                                       I0
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
                        I1                            I3
                         │                             │
                         ▼                             │
                        I2 ◄───────────────────────────┘
                         │
                         ▼
                        I4
                         │
                         ▼
                        I5
                         │
                         ▼
                        I6
                         │
                         ▼
                       v0.3
```

## High-conflict surfaces learned from the work

### `src/shared/*`

Trace/snapshot fields are semantic contracts. Give one PR ownership of a contract change before Host and client consumers branch from it.

### `src/client/DevtoolsShell.tsx` and shared view state

Cross-navigation, view additions, and poller ownership can easily collide. Split pure/fixture views first, then integrate shared shell behavior serially.

### `src/host/cordis-adapter.ts` vs instrumentation compatibility

Observer internal access and instrumented dispatch compatibility are different responsibilities. Listener/live-Fiber registry reads stay in `cordis-adapter.ts`; waterfall execution instrumentation stays in the dedicated controller rather than turning the observer adapter into a mixed seam.

### Observer history vs profiler traces

`ObserverCollector` owns bounded dispatch occurrence history. `WaterfallTraceStore` owns bounded instrumented execution traces. Keeping them separate avoided turning the default observer poller into a profiler transport.

## What to do for future milestones

Do not mechanically reuse these branch names or wave counts. Rebuild a dependency graph from the actual next milestone, then apply the reusable rules above: freeze semantics first, parallelize disjoint evidence/layers, and serialize high-conflict shared-contract or shell changes.
