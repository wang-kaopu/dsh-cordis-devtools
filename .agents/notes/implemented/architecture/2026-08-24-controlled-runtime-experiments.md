# Agent Note: Controlled waterfall runtime experiments

Status: implemented

## Problem

v0.5 made live Cordis diagnostics and before/after Runtime Verification available to DSH and external MCP Agents, but per-listener waterfall timing, settlement, and `next()` behavior exist only while the explicit instrumentation seam is enabled.

Exposing the old raw boolean profiler toggle to an Agent would have no owner, timeout, permission boundary, or safe concurrency model. A disconnected Agent could leave instrumentation active, one caller could disable another, and external loopback MCP mutation would have authority without authentication. Human Profiler control also shares the same `events.dispatch` seam, so the three callers require one ownership model.

## Decision

v0.6 implements **Controlled Runtime Experiments** with one first experiment type: a finite waterfall profiling lease.

### One coordinator owns all instrumentation mutation

`WaterfallExperimentCoordinator` sits above `WaterfallInstrumentationController`. Human UI, DSH tools, and MCP tools route all production mutation through that coordinator.

The coordinator has one factual owner slot:

```text
disabled + none
enabled  + human
enabled  + agent { leaseId, source, startedAt, expiresAt }
conflict
unsupported
```

A new owner cannot steal an active slot. Agent exact-stop/expiry first compare the current lease id. Human emergency stop may always reduce instrumentation by ending an Agent lease. `conflict` and `unsupported` remain fail-closed; cleanup never overwrites a dispatch implementation the controller no longer owns.

### Agent leases are finite

Agent start creates an opaque random lease id. Defaults are `15000 ms` with maximum `60000 ms`; there is no infinite lease, renewal, or concurrent lease support in v0.6.

Timeout and plugin disposal perform owner-safe cleanup only. Stale timeout callbacks and stale stop requests cannot disable a later owner.

### Traces carry exact experiment attribution

A waterfall trace created under an Agent lease carries optional `experimentId = leaseId`; Human traces remain untagged. `profilerTraces` accepts an exact optional `experimentId` filter while preserving bounded-retention semantics and original association for late settlement/late `next()` updates.

### `CordisRuntime` remains read-only

Experiment status is readable through Runtime Diagnostics / Cordis Inspect / MCP, but mutation is not added to `CordisRuntime`.

DSH mutation uses:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

The start tool asks the existing DSH `ctx.approval` service before coordinator mutation. Only `allowed-once` proceeds. Missing Agent/approval, rejection, cancellation, or unavailable answerer fail closed. Stop requires the exact lease id and needs no second approval because it only reduces instrumentation.

The approval is called from the start tool body rather than relying solely on a reorderable `tools/pre-execute` listener, so sibling policy ordering cannot bypass the mandatory experiment grant.

### External MCP mutation is explicit operator authority

An external MCP request has no authentic DSH Agent/session identity and does not impersonate one.

The existing `mcp.enabled: true` configuration remains the original seven read-only tools. External experiment mutation is hidden unless explicitly configured with both a non-empty bearer token and `experiments.enabled: true`.

When a token is configured, every MCP request must authenticate with `Authorization: Bearer ...`. The endpoint remains `127.0.0.1` only. Token material is never logged, returned, or copied into diagnostic/trace/checkpoint contracts.

### Real DSH authority proof

The final E2E uses the shipped SessionStore, ToolRuntime, ApprovalService, official MCP SDK Client, real Cordis waterfall, and Chromium UI without model/API credentials.

A first integration run demonstrated that a session-shaped fake is insufficient: real ToolRuntime rejects a caller whose session is not live in SessionStore. The final proof therefore creates an authoritative live session and opens a real turn before executing the DSH tools, preserving approval audit/session authority rather than mocking it away.

## Alternatives considered

### Expose the raw instrumentation boolean toggle to Agents

Rejected. It has no owner, lease, timeout, permission, or stale-caller protection.

### Put start/stop on `CordisRuntime`

Rejected. Cordis Inspect remains the read/inspection surface; mutation has a different trust boundary.

### Use only `tools/pre-execute` for DSH approval

Rejected as the mandatory gate because it is an extensible reorderable waterfall. The start body itself asks through the shared approval service before mutation.

### Require approval for stop

Rejected. Exact stop is cleanup that reduces instrumentation and must remain available when an interactive channel disappears.

### Impersonate a DSH Agent for external MCP

Rejected. External MCP has no truthful DSH session owner. Operator capability + authentication is the accurate authority model.

### Treat loopback as sufficient mutation authority

Rejected. Another local process can access loopback; external mutation requires bearer authentication.

### Add generic runtime mutation, reload, renewal, or multiple leases

Rejected for v0.6. They have separate lifecycle/authority contracts and are not necessary to validate the first reversible experiment.

## Consequences

- Every production instrumentation mutation now has one shared owner model.
- Human and Agent profiling cannot silently overwrite each other.
- Agent instrumentation cannot remain active indefinitely under the supported API.
- DSH approval is auditable through the existing real session/approval path.
- External mutation is explicit and authenticated while the v0.5 read-only MCP contract stays backward-compatible.
- Agent traces can be queried by exact lease id without timestamp inference, but remain bounded evidence rather than a lossless experiment log.
- Human emergency stop remains authoritative.
- Metadata/privacy boundaries are unchanged: no raw event payloads, returns, error details, prompts, tool results, files, config, credentials, or bearer tokens are collected.
- v0.6 still does not provide arbitrary Cordis mutation, automatic reload/orchestration, remote MCP, payload capture, root-cause verdicts, or non-waterfall profiling.