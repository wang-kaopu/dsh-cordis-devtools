# Roadmap

The repository version is currently `0.5.0`; the v0.5 Runtime Verification milestone is complete at repository level.

## Current planning — v0.6 Controlled Runtime Experiments

- Product/design: [v0.6 Controlled Runtime Experiments](v0.6-controlled-runtime-experiments.md)
- Execution roadmap: [v0.6 Controlled Runtime Experiments roadmap](v0.6-roadmap.md)
- Parallel development: [v0.6 parallel development plan](v0.6-parallel-work.md)
- Architecture decision: [.agents proposed Controlled Runtime Experiments note](../.agents/notes/proposed/architecture/2026-08-24-controlled-runtime-experiments.md)

v0.6 is intentionally narrow: one finite, owned waterfall-profiling experiment. It introduces a single coordinator for Human/Agent instrumentation ownership, one-shot DSH approval before Agent start, and explicitly authenticated/capability-gated mutation for external MCP. Generic Cordis mutation, automatic reload, remote MCP, and payload capture remain outside the milestone.

## Completed milestone — v0.5 Runtime Verification

- Product/design: [v0.5 Runtime Verification](v0.5-runtime-verification.md)
- Completed execution roadmap: [v0.5 Runtime Verification roadmap](v0.5-roadmap.md)
- Parallel development record: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Implemented architecture decision: [Runtime Verification Agent Note](../.agents/notes/implemented/architecture/2026-08-24-runtime-verification.md)

v0.5 keeps the Agent-facing path read-only and adds caller-owned checkpoints plus semantic before/after diff. DSH Cordis Inspect and external MCP share the same implementation and are proven against one real Cordis `2 → 1` lifecycle transition.

## Completed milestone — v0.4 Agent Runtime Diagnostics

- Product/design: [v0.4 Agent Runtime Diagnostics](v0.4-agent-runtime-diagnostics.md)
- Agent usage and evidence semantics: [Agent Runtime Diagnostics guide](agent-runtime-diagnostics.md)
- Completed roadmap: [v0.4 Agent Runtime Diagnostics roadmap](v0.4-roadmap.md)

## Historical planning

- Historical v0.3 roadmap: [archived v0.3 roadmap](archive/v0.3/roadmap.md)
- Historical v0.3 parallel record: [archived v0.3 parallel-work record](archive/v0.3/parallel-work.md)

Repository readiness does not imply npm publication, a Git tag, or a GitHub Release.