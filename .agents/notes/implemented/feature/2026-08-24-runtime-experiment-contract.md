# Agent Note: Runtime experiment shared contract

Status: implemented

## Problem

v0.6 introduces the first Agent-driven runtime mutation: a finite waterfall profiling experiment. The coordinator, DSH tool adapter, MCP adapter, trace tagging, and Human Profiler all need one transport-neutral vocabulary for ownership, lease identity, TTL, status, and start/stop outcomes. If each branch invents those shapes independently, the authority model can drift before the adapters are integrated.

## Decision

`src/shared/experiments.ts` owns the serialized experiment vocabulary before any mutation implementation fans out.

The contract fixes:

- default Agent lease TTL at 15 seconds and the default maximum at 60 seconds;
- opaque string `leaseId` values;
- Agent sources `dsh | mcp`;
- one factual control owner: `none`, `human`, or one Agent lease;
- status as low-level instrumentation state plus the current owner;
- start outcomes `started | busy | unsupported | conflict`;
- exact-lease stop outcomes `stopped | not-active | lease-mismatch | conflict`;
- explicit coordinator end reasons for stop, expiry, Human stop, disposal, and conflict;
- `WaterfallExperimentId` as the metadata identity used to tag traces, equal to the owning Agent lease id.

A failed start always has `lease: null`; adapters must not manufacture a lease from optimistic intent. The shared contract contains no DSH Agent/session object, MCP request/auth object, timer, controller reference, approval result, or raw payload.

This PR deliberately does not add `experimentId` to `WaterfallDispatchTrace` yet. The trace-association workstream owns that production trace change after the shared identity type is available.

## Alternatives considered

### Let the coordinator own private types and duplicate transport schemas later

Rejected. DSH, MCP, diagnostics, and UI would then need to reconstruct the same state vocabulary and could disagree about busy/conflict/lease ownership semantics.

### Put DSH approval or MCP authentication outcomes into the shared runtime contract

Rejected. `approval-denied` and `unauthenticated` are adapter/transport authority boundaries. The runtime coordinator should only describe whether instrumentation ownership changed and why it could not start or stop.

### Use numeric or source-prefixed lease ids in the public contract

Rejected. Callers only need equality and opaque round-tripping. The coordinator implementation remains free to choose collision-resistant ids without making their representation semantic.

### Add lease renewal now

Rejected by the approved v0.6 architecture. A lease has one finite expiry; renewal would add a second mutation path and stale-owner race semantics that are not needed for the first controlled experiment.

## Consequences

The four post-contract workstreams can proceed independently against one vocabulary: coordinator core, trace association, DSH approval tools, and MCP auth/capability. The later service-integration gate can compose them without translating competing lease/status types.

The TTL constants are default policy values, not permission. DSH still requires one-shot approval before start, and external MCP still requires explicit experiment capability plus bearer authentication. Human ownership is represented in the same status contract but does not receive an Agent lease id or expiry.
