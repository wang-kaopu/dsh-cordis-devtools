# Parallel development plan

The completed v0.2/v0.3 parallel development record is archived. Current planning is now v0.5 Runtime Verification.

- Current dependency graph and branch ownership: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Current milestone roadmap: [v0.5 Runtime Verification roadmap](v0.5-roadmap.md)
- Product/contract design: [v0.5 Runtime Verification](v0.5-runtime-verification.md)
- Historical v0.3 parallel record: [archived parallel-work record](archive/v0.3/parallel-work.md)

The v0.5 plan intentionally uses two fan-out points: checkpoint/diff/fixture after the shared contract, then DSH/MCP adapters after query integration. Shared contract and final real-DSH orchestration remain sequential gates to avoid duplicate semantics and merge-heavy contention.
