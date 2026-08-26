# Parallel development plan

The v0.5 Runtime Verification, v0.6 Controlled Runtime Experiments, and v0.7
Agent Debug parallel plans are complete. The current v0.8 Local Agent Bridge
& Bootstrap dependency graph is tracked in the bridge Agent Note.

- Current dependency graph and implementation decision: [DSH Local Agent Bridge & Bootstrap Note](../.agents/notes/implemented/architecture/2026-08-26-agent-bridge-bootstrap.md)
- Current milestone overview: [repository roadmap](roadmap.md)
- Historical v0.7 Agent Debug dependency graph: [v0.7 DSH DevTools for Agents Agent Note](../.agents/notes/implemented/architecture/2026-08-25-dsh-devtools-for-agents.md)
- Previous dependency graph and branch ownership: [v0.6 parallel development plan](v0.6-parallel-work.md)
- Previous milestone roadmap: [v0.6 Controlled Runtime Experiments roadmap](v0.6-roadmap.md)
- Product/authority design: [v0.6 Controlled Runtime Experiments](v0.6-controlled-runtime-experiments.md)
- Completed v0.5 parallel record: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Historical v0.3 parallel record: [archived parallel-work record](archive/v0.3/parallel-work.md)

The v0.8 plan uses three deliberate fan-out points:

```text
profile/token bootstrap
  ├─ secure token store + mcp.tokenFile
  ├─ YAML patch preservation + profile lock
  └─ Codex registration + doctor discovery

Agent bridge
  ├─ stdio MCP server
  ├─ lazy authenticated HTTP forwarding
  └─ reconnect-on-explicit-retry / no auto-replay

release verification
  ├─ package bin + packed artifact
  ├─ bridge protocol tests
  └─ documentation / Skill / E2E
```

The completed v0.6 plan used two deliberate fan-out points:

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
