# Roadmap

The repository version is currently `0.7.0`; the v0.7 DSH DevTools for Agents feature line is repository-ready.

## Current feature line — v0.7 DSH DevTools for Agents

- Product and usage: [Agent Runtime Diagnostics guide](agent-runtime-diagnostics.md)
- Runtime architecture: [DSH DevTools for Agents architecture](architecture.md)
- Architecture decision: [DSH DevTools for Agents Agent Note](../.agents/notes/implemented/architecture/2026-08-25-dsh-devtools-for-agents.md)

v0.7 adds the MCP-first target/session/snapshot/wait workflow, the `dsh-cordis-debug` CLI, and the packaged `dsh-runtime-debugging` Skill over one Host-owned Agent Debug Core. The existing focused diagnostics, Runtime Verification, and authority-gated waterfall experiment remain part of the product.

Raw CDP-compatible WebSocket transport, automatic reload/orchestration, breakpoints, pause/step, expression evaluation, arbitrary mutation, and payload capture remain outside this feature line.

## Completed milestone — v0.6 Controlled Runtime Experiments

- Product/design: [v0.6 Controlled Runtime Experiments](v0.6-controlled-runtime-experiments.md)
- Completed execution roadmap: [v0.6 Controlled Runtime Experiments roadmap](v0.6-roadmap.md)
- Parallel development record: [v0.6 parallel development record](v0.6-parallel-work.md)
- Implemented architecture decision: [Controlled Runtime Experiments Agent Note](../.agents/notes/implemented/architecture/2026-08-24-controlled-runtime-experiments.md)

v0.6 keeps diagnostics/verification read-only and adds one finite waterfall profiling experiment. One coordinator owns Human/DSH/MCP instrumentation mutation; DSH start requires one-shot approval; external MCP mutation is explicit capability + bearer-auth gated; Agent traces are attributable by exact lease id; Human emergency stop remains authoritative.

Generic Cordis mutation, automatic reload/orchestration, remote MCP, payload capture, persistent approvals, lease renewal/concurrency, and non-waterfall profiling remain outside the milestone.

## Completed milestone — v0.5 Runtime Verification

- Product/design: [v0.5 Runtime Verification](v0.5-runtime-verification.md)
- Completed execution roadmap: [v0.5 Runtime Verification roadmap](v0.5-roadmap.md)
- Parallel development record: [v0.5 parallel development plan](v0.5-parallel-work.md)
- Implemented architecture decision: [Runtime Verification Agent Note](../.agents/notes/implemented/architecture/2026-08-24-runtime-verification.md)

v0.5 added caller-owned checkpoints plus semantic before/after diff. DSH Cordis Inspect and external MCP share the same implementation and are proven against one real Cordis `2 → 1` lifecycle transition.

## Completed milestone — v0.4 Agent Runtime Diagnostics

- Product/design: [v0.4 Agent Runtime Diagnostics](v0.4-agent-runtime-diagnostics.md)
- Agent usage and evidence semantics: [Agent Runtime Diagnostics guide](agent-runtime-diagnostics.md)
- Completed roadmap: [v0.4 Agent Runtime Diagnostics roadmap](v0.4-roadmap.md)

## Historical planning

- Historical v0.3 roadmap: [archived v0.3 roadmap](archive/v0.3/roadmap.md)
- Historical v0.3 parallel record: [archived v0.3 parallel-work record](archive/v0.3/parallel-work.md)

Repository readiness does not imply npm publication, a Git tag, or a GitHub Release.
