# Parallel development plan

The v0.5 Runtime Verification parallel plan is now complete at repository level.

- Completed dependency graph and branch ownership: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Completed milestone roadmap: [v0.5 Runtime Verification roadmap](v0.5-roadmap.md)
- Implemented product/contract design: [v0.5 Runtime Verification](v0.5-runtime-verification.md)
- Historical v0.3 parallel record: [archived parallel-work record](archive/v0.3/parallel-work.md)

The v0.5 plan used two deliberate fan-out points:

```text
shared verification contract
  ├─ checkpoint projection
  ├─ semantic diff
  └─ real Cordis transition fixture

query integration
  ├─ DSH Cordis Inspect adapter
  └─ MCP adapter
```

A single final real-DSH orchestration then combined both Agent paths against the same `2 → 1` Cordis lifecycle transition. The shared contract and final orchestration stayed sequential so parallel work did not create competing identity/diff semantics.

The final E2E exposed one useful contract correction: runtime listener registration `order` is capture-local evidence, not a stable cross-checkpoint semantic identity field. That decision is preserved by the final v0.5 docs/tests rather than hidden as a merge-time detail.