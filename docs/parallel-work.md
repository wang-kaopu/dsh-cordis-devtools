# Parallel development plan

The v0.5 Runtime Verification parallel plan is complete. Current planning is v0.6 Controlled Runtime Experiments.

- Current dependency graph and branch ownership: [v0.6 parallel development plan](v0.6-parallel-work.md)
- Current milestone roadmap: [v0.6 Controlled Runtime Experiments roadmap](v0.6-roadmap.md)
- Product/authority design: [v0.6 Controlled Runtime Experiments](v0.6-controlled-runtime-experiments.md)
- Completed v0.5 parallel record: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Historical v0.3 parallel record: [archived parallel-work record](archive/v0.3/parallel-work.md)

The v0.6 plan uses two deliberate fan-out points:

```text
shared experiment contract
  ├─ lease coordinator
  ├─ trace tagging
  ├─ DSH approval/tool adapter
  └─ MCP auth/capability helper

service/control integration
  ├─ DSH live wiring
  ├─ MCP live wiring
  └─ Human Profiler ownership UX
```

Authority semantics remain sequential gates. In particular, sibling branches do not get to invent competing rules for lease ownership, DSH approval, external MCP authentication, Human emergency stop, or experiment trace association. The final real-DSH orchestration is also single-owner so all three control surfaces are proved against one runtime rather than separate mocks.