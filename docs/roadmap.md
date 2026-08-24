# Roadmap

The repository version is currently `0.5.0`; the v0.5 Runtime Verification milestone is complete at repository level.

## Completed milestone — v0.5 Runtime Verification

- Product/design: [v0.5 Runtime Verification](v0.5-runtime-verification.md)
- Completed execution roadmap: [v0.5 Runtime Verification roadmap](v0.5-roadmap.md)
- Parallel development record: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Implemented architecture decision: [Runtime Verification Agent Note](../.agents/notes/implemented/architecture/2026-08-24-runtime-verification.md)

v0.5 keeps the Agent-facing path read-only and adds caller-owned checkpoints plus semantic before/after diff. DSH Cordis Inspect and external MCP share the same implementation and are proven against one real Cordis `2 → 1` lifecycle transition.

Controlled runtime experiments, including Agent-driven profiler mutation/leases, remain outside v0.5.

## Completed milestone — v0.4 Agent Runtime Diagnostics

- Product/design: [v0.4 Agent Runtime Diagnostics](v0.4-agent-runtime-diagnostics.md)
- Agent usage and evidence semantics: [Agent Runtime Diagnostics guide](agent-runtime-diagnostics.md)
- Completed roadmap: [v0.4 Agent Runtime Diagnostics roadmap](v0.4-roadmap.md)

## Historical planning

- Historical v0.3 roadmap: [archived v0.3 roadmap](archive/v0.3/roadmap.md)
- Historical v0.3 parallel record: [archived v0.3 parallel-work record](archive/v0.3/parallel-work.md)

Repository readiness does not imply npm publication, a Git tag, or a GitHub Release.