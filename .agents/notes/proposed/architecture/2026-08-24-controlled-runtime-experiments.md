# Agent Note: Controlled waterfall runtime experiments

Status: proposed

## Problem

v0.5 lets DSH and external MCP Agents inspect live Cordis facts, keep caller-owned checkpoints, and verify before/after topology changes. The remaining gap is execution evidence that the observer path cannot truthfully derive: per-listener waterfall timing, settlement, and `next()` behavior exist only while the explicit instrumentation seam is enabled.

Giving an Agent the existing raw `setInstrumentationEnabled(true/false)` mutation would be unsafe. That method has no owner, no timeout, no permission boundary, and no way to distinguish a human profiling session from an Agent-owned capture. A crashed or disconnected Agent could leave the runtime instrumented indefinitely, two Agents could disable each other, and an external loopback MCP client would gain mutation authority without authentication.

The current Human Profiler also shares the same controller. Any Agent design must therefore coordinate with the existing UI rather than add a second owner of `events.dispatch`.

## Proposal

Add a v0.6 **Controlled Runtime Experiments** layer whose first and only experiment type is a bounded waterfall profiling lease.

### One coordinator owns all instrumentation mutation

Introduce a Host-side `WaterfallExperimentCoordinator` above `WaterfallInstrumentationController`. The controller remains the low-level compatibility seam, but no Human/Agent transport calls `enable()` / `disable()` directly after the migration.

The coordinator owns one control slot with factual states equivalent to:

```text
disabled
human
agent lease { leaseId, source, startedAt, expiresAt }
conflict
unsupported
```

Only one instrumentation owner can exist at a time.

- Human `Enable profiling` acquires the human slot.
- An Agent start request succeeds only while instrumentation is disabled and no Human/Agent owner exists.
- A second Agent start returns a structured busy/current-owner result and performs no mutation.
- Agent stop requires the exact active `leaseId`; a stale/wrong id performs no mutation.
- The Human UI always keeps an emergency stop path. A Human stop may terminate an active Agent lease; the lease becomes ended and later Agent stop/status calls report the factual ended state rather than re-enabling anything.
- `conflict` and `unsupported` remain fail-closed. Cleanup never overwrites a dispatch implementation the controller no longer owns.

### Every Agent start is a finite lease

An Agent start creates a random opaque lease id and a mandatory finite expiry.

Configuration provides finite defaults, initially:

```text
defaultTtlMs = 15000
maxTtlMs = 60000
```

Both values are positive/finite and `defaultTtlMs <= maxTtlMs`. A call may request a shorter/equal TTL; there is no indefinite Agent lease and no v0.6 renewal API.

Expiry checks that the same lease still owns the coordinator before attempting disable. Plugin disposal clears the timer and performs only owner-safe cleanup.

### Associate traces with the experiment

A waterfall trace created while an Agent lease owns instrumentation carries an optional `experimentId` equal to the lease id. Human profiling traces remain untagged.

`profilerTraces` gains an optional exact `experimentId` filter. This makes an experiment queryable without guessing from old retained traces. The existing bounded-retention semantics remain authoritative: an experiment filter can still return an incomplete retained subset after ring-buffer eviction, and late settlement/late `next()` updates remain attached to the same tagged trace.

### Read status stays on the diagnostic path

Add a read-only experiment-status query to `RuntimeDiagnosticsQuery`.

DSH exposes it through the existing `CordisRuntime` Inspect Provider. MCP exposes an equivalent read-only tool. Status reports current control owner/state and lease expiry metadata, but does not infer whether an experiment is useful or complete.

### DSH mutation uses a dedicated Tool, not Cordis Inspect

`CordisRuntime` remains an inspection Provider. Mutating Agent operations are registered as dedicated DSH tools, initially:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

The start tool must obtain a one-shot grant through DSH's existing `ctx.approval` seam before touching the coordinator. Only `allowed-once` proceeds. Missing approval service, missing/foreign Agent identity, rejection, cancellation, or unavailable answerer fail closed.

The approval request is issued as the first action in the start tool body, using the current tool call/Agent identity. This is preferred over relying on a reorderable `tools/pre-execute` listener: another first-answer policy must not be able to bypass the package's mandatory experiment approval.

The stop tool does not require a second approval because it can only end the exact active lease and reduces instrumentation. Human emergency stop is likewise always available.

### External MCP mutation is explicit operator capability

An external MCP request has no DSH Agent/session identity, so it cannot truthfully route through `ctx.approval`.

MCP experiment mutation is therefore hidden by default. Proposed config:

```yaml
mcp:
  enabled: true
  port: 43127
  token: ${CORDIS_DEVTOOLS_MCP_TOKEN}
  experiments:
    enabled: true
```

Rules:

- read-only MCP remains backward compatible when no token/experiment capability is configured;
- `mcp.experiments.enabled: true` requires a non-empty bearer token at plugin activation;
- when a token is configured, all MCP requests must authenticate with `Authorization: Bearer ...`;
- start/stop mutation tools are registered only when experiment capability is enabled;
- the token is never logged, returned in status, or copied into trace/checkpoint data;
- bind remains `127.0.0.1`; v0.6 does not add remote/LAN exposure.

The config is an operator-level capability grant, not a fake per-call human approval. MCP annotations must identify start/stop as mutating and non-idempotent where applicable; annotations are descriptive, not the enforcement boundary.

## Alternatives considered

### Expose `setInstrumentationEnabled()` directly to Agents

Rejected. It has no owner, TTL, cleanup contract, or concurrency semantics and would let one caller disable another caller's instrumentation.

### Put Agent start/stop methods on `CordisRuntime`

Rejected. `cordisInspect` is the read/inspection path and v0.5 intentionally used it that way. Mixing mutation into the generic inspection Provider would blur the trust boundary and make approval behavior less visible.

### Use only `tools/pre-execute` to ask before the DSH start tool

Rejected as the mandatory safety gate. `tools/pre-execute` is an extensible first-answer waterfall; policy composition is useful, but the package cannot rely on sibling listener ordering to guarantee that its mutation always asks. Calling the existing approval seam from the start body before mutation preserves the same one-shot approval/audit mechanism without making the gate bypassable by another pre-execute answer.

### Require approval for stop

Rejected. Stop is owner-checked cleanup that reduces instrumentation. Making cleanup depend on a second interactive grant can leave the runtime instrumented until timeout when a channel disappears.

### Let external MCP impersonate a DSH Agent to use `ctx.approval`

Rejected. The request has no authentic DSH Agent/session owner. Inventing one would create false audit/routing semantics. External mutation uses an explicit operator capability instead.

### Allow mutation on unauthenticated loopback MCP because it is local

Rejected. Loopback is not a confidentiality or authority boundary against other local processes. v0.6 requires bearer authentication whenever external mutation is enabled.

### Add generic runtime mutation/reload APIs in the same milestone

Rejected. The first experiment has a known reversible seam and existing parity tests. Source reload, arbitrary event invocation, listener mutation, and generic execution controls have different ownership and safety contracts.

### Add lease renewal/persistent grants

Rejected for the first slice. A finite one-shot experiment proves the lifecycle model without introducing grant persistence or indefinite instrumentation.

## Acceptance criteria

- all Human and Agent instrumentation mutation routes through one coordinator;
- Agent leases are finite, owner-checked, timeout-cleaned, and plugin-disposal-cleaned;
- a stale lease cannot disable a later Human/Agent owner;
- Human emergency stop can terminate an Agent lease safely;
- conflict/unsupported behavior remains fail-closed and never overwrites another dispatch patch;
- traces created under an Agent lease are queryable by exact `experimentId` while preserving bounded-retention semantics;
- DSH start is a dedicated model tool and requires one-shot `ctx.approval`; absence/rejection/cancellation/unavailable all deny before mutation;
- DSH stop is exact-lease cleanup and needs no second approval;
- external MCP start/stop are absent by default and require explicit experiment capability plus bearer authentication;
- enabling external experiments without a token fails plugin activation/config validation;
- no token, raw event payload, result/error payload, prompt, file content, or credential enters trace/checkpoint contracts;
- one real DSH test proves approved DSH lease start → real waterfall trace → stop/cleanup;
- one real external MCP test proves authenticated lease start → real trace → timeout or stop cleanup;
- combined tests prove Human UI ownership/status remains coherent and existing observer/verification behavior stays green;
- v0.6 does not add generic runtime mutation, automatic reload, remote MCP, payload capture, or root-cause verdicts.

## Risks

- moving Human enable/disable behind the coordinator can regress existing Profiler UX if owner state is not transported clearly;
- timer cleanup races with Human force-stop or conflict; every cleanup path must compare current ownership before mutating;
- approval availability varies by DSH composition; the DSH start tool must fail closed rather than silently bypass approval;
- adding MCP authentication changes connection behavior when a token is configured and needs real official-SDK coverage;
- trace tagging changes the shared trace contract and must not alter caller-visible waterfall execution semantics;
- bounded trace retention means `experimentId` filtering is not a lossless experiment log; Agent output must preserve retained-window semantics;
- multiple Agents may observe one active lease id; this is acceptable because stopping instrumentation is a safety action, while starting still requires the appropriate authority boundary.