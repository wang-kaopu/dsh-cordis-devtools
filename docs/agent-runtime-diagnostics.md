# Agent Runtime Diagnostics, Verification, and Controlled Experiments

This guide describes the repository-level `0.6.0` Agent surface. Runtime Diagnostics and Runtime Verification remain read-only; v0.6 adds one separately authority-gated mutation: a finite waterfall profiling experiment owned by the shared Host coordinator.

## What Agent access adds

Live runtime evidence can prove facts source reading alone cannot:

- current listener multiplicity/order and owner Fibers;
- authoritative live Fiber/inject/Effect/owned-registration state;
- recent dispatch occurrences inside a bounded retained window;
- retained waterfall traces and exact Agent experiment attribution;
- canonical caller-owned topology checkpoints;
- semantic before/after Event/Listener/Fiber multiplicity changes;
- current Human/Agent waterfall instrumentation owner and lease expiry.

It does not replace source analysis. Agents should combine runtime evidence with source, tests, and logs, and must not convert bounded observations into complete-history or root-cause claims.

## Read-only query vocabulary

DSH Cordis Inspect and MCP share the same Host-owned semantics:

| Logical query | Purpose |
| --- | --- |
| `runtimeSummary` | Compact live counts and bounded evidence metadata. |
| `inspectEvent` | Current registrations for one exact event. |
| `inspectFiber` | Authoritative live Fiber state by uid or exact name. |
| `searchDispatches` | Retained observer dispatch occurrences newest-first. |
| `profilerTraces` | Retained profiler traces, optionally exact-filtered by `experimentId`. |
| `captureCheckpoint` | Caller-owned versioned checkpoint of current topology. |
| `compareCurrent` | Compare a supplied baseline with fresh current topology. |
| `waterfallExperimentStatus` | Read current instrumentation owner/lease facts. |

None of these operations enables instrumentation.

## DSH read path

When DSH includes its first-party Cordis Inspect infrastructure, the plugin registers:

```text
platform: host
provider: CordisRuntime
```

The normal model path remains:

```text
cordis_inspect_list
  ↓
find CordisRuntime
  ↓
cordis_inspect_query
```

`CordisRuntime` stays an inspection Provider. v0.6 does **not** put mutation methods on it.

## Runtime Verification

An Agent can preserve a focused baseline before normal development work:

```text
captureCheckpoint(scope?)
        ↓
caller keeps returned checkpoint
        ↓
edit / normal reload workflow
        ↓
compareCurrent({ baseline })
```

Checkpoints are self-contained JSON values, not server-side ids. They include authoritative current Event/Listener/live-Fiber topology and metadata-only Effects; bounded dispatch/profiler history is excluded.

Cross-checkpoint identity is semantic rather than runtime-local:

- listener id, registration order, owner/Fiber uid are capture-local evidence;
- Listener groups use event + owner name + `prepend` + `global`;
- Fiber groups use canonical current metadata;
- equivalent duplicates compare as multiplicities such as `2 → 1`.

`compareCurrent` reports mechanical changes only. It does not claim `fixed`, `rootCause`, or confidence.

## DSH controlled experiment path

v0.6 registers two dedicated DSH tools:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

Start is a mutation. Its body requests one-shot approval through the real DSH `ctx.approval` service before touching the shared coordinator. Only `allowed-once` proceeds; rejection, cancellation, unavailable/missing approval, or missing Agent identity fail closed.

A successful start returns a finite lease with an opaque `leaseId` and expiry. Default TTL is 15 seconds and the maximum supported TTL is 60 seconds. There is no renewal or indefinite lease in v0.6.

Stop needs no second approval because it can only end the exact active lease. A stale/wrong lease id performs no mutation.

Recommended flow:

```text
cordis_start_waterfall_experiment({ ttlMs? })
        ↓
leaseId
        ↓
reproduce one waterfall behavior
        ↓
read profilerTraces({ experimentId: leaseId })
        ↓
cordis_stop_waterfall_experiment({ leaseId })
        ↓
status confirms disabled/no Agent owner
```

If the Agent disappears, TTL cleanup rechecks exact ownership before disabling.

## External MCP path

The MCP server runs inside the same DSH Host process and is disabled by default.

### Read-only compatibility

The original configuration remains:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

Endpoint:

```text
http://127.0.0.1:43127/mcp
```

This continues to expose the original seven read-only tools:

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
cordis_capture_checkpoint
cordis_compare_current
```

`cordis_profiler_traces` now accepts optional exact `experimentId`, but remains read-only.

### Explicit external experiment capability

External MCP has no truthful DSH Agent/session identity, so it does not impersonate one or use `ctx.approval`. Mutation authority is an explicit operator capability:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      token: ${CORDIS_DEVTOOLS_MCP_TOKEN}
      experiments:
        enabled: true
```

Rules:

- experiment mutation tools are absent by default;
- enabling experiments requires a non-empty bearer token;
- when `token` is configured, **every** MCP request must send `Authorization: Bearer ...`;
- authentication is checked before MCP dispatch reaches the coordinator;
- the server stays bound to `127.0.0.1`;
- token material is never returned/logged or copied into trace/checkpoint data.

Experiment-enabled MCP adds:

```text
cordis_waterfall_experiment_status
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

A typical external flow mirrors DSH:

```text
start → leaseId → reproduce → cordis_profiler_traces({ experimentId: leaseId }) → stop/TTL
```

## Human ownership interaction

Human Profiler, DSH tools, and MCP tools share one `WaterfallExperimentCoordinator`.

Therefore:

- an Agent cannot silently steal active Human profiling;
- a second Agent start reports busy/current-owner facts rather than mutating;
- Human UI identifies Agent source and expiry;
- Human **Stop Agent experiment** is an emergency-stop path and may always reduce instrumentation;
- stale Agent stop/timeout cannot disable a later owner.

## Evidence semantics

### Empty dispatch result

A bounded dispatch search returning no rows means **not observed in the retained window**, not “never happened.”

### `truncated` vs `bounded`

- `truncated: true` means the query limit omitted matches that are still retained.
- `bounded: true` means older runtime history may already have been overwritten.

These are different limitations.

### Live vs historical Fiber references

Current `fibers` inventory is authoritative. Historical dispatch/trace owner references can outlive the Fiber and must not be promoted to live state. Navigation is valid only while the uid still exists in current live inventory.

### Experiment attribution is not completeness

`experimentId = leaseId` identifies which Agent lease created a trace. The profiler store is still bounded; exact filtering cannot prove every trace from the experiment is retained.

Late settlement/late `next()` facts remain attached to the original tagged trace even after the lease has ended.

### Profiler facts are not root-cause verdicts

Per-listener timing, entered/returned/settled state, and repeated/late `next()` are observed facts. The project does not invent `selfTime`, definitive chain-stop/veto, root cause, confidence, or fix-success fields.

## Privacy and security

Current contracts do not retain raw event arguments, listener return values, error objects/messages, prompts, tool outputs, file contents, plugin config, credentials, bearer tokens, or raw Effect functions/disposers.

Loopback is a network exposure boundary, not sufficient mutation authority against other local processes. That is why external experiment mutation requires bearer authentication even though the endpoint remains `127.0.0.1`.

## Real DSH proof

CI runs a keyless real DSH controlled-experiment smoke that uses:

- a real `SessionStore` live session and open turn;
- real ToolRuntime;
- real ApprovalService;
- real Cordis waterfall;
- official MCP SDK Client;
- Chromium Human Profiler.

It proves unavailable/rejected DSH approval is no-op, allowed-once creates a tagged finite DSH lease, stale stop is safe, exact stop works, authenticated MCP creates/query/stops or expires a tagged lease, Human emergency stop works, and ordinary Human profiling remains healthy afterward.

The existing v0.5 Runtime Verification real DSH smoke runs before it as a regression.

## Deferred beyond v0.6

Not provided by this guide/version:

- automatic source/plugin reload or edit→reload orchestration;
- arbitrary Cordis event execution;
- generic listener/service/config mutation;
- persistent approval grants;
- lease renewal or concurrent experiment leases;
- remote/LAN MCP;
- raw payload capture;
- automatic `diagnose()` root-cause verdicts;
- non-waterfall profiler instrumentation.
