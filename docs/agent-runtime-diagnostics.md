# DSH DevTools for Agents (v0.7)

This is the user guide for debugging a live DeepSeek Harness (DSH) / Cordis
runtime from an MCP-capable coding Agent. The primary route is MCP; the
packaged JSON CLI and the installable Skill use the same Host-owned runtime
facts.

The product follows the useful part of a Chrome DevTools workflow—discover a
target, attach a session, explore, wait for changes, verify a before/after
transition, and optionally profile one bounded operation—without exposing raw
CDP frames or claiming CDP wire compatibility.

```text
Agent → MCP tools → Host AgentDebugService → live Cordis observer/profiler
             ↘ JSON CLI / Skill use the same MCP surface
```

## What the Agent can observe

The Host is the source of truth for current Event/listener/Fiber topology,
bounded dispatch history, retained waterfall traces, verification checkpoints,
and the shared experiment coordinator. Results are metadata-only. They do not
include event arguments, return values, error objects/messages, prompts, tool
outputs, file contents, configuration, credentials, or bearer tokens.

The surface is evidence-oriented: a candidate, timeout, empty bounded query,
or clean comparison is a mechanical fact. It is not an automatic root-cause,
`fixed`, remediation, confidence, or successful-fix verdict. Retained history
is bounded and therefore cannot prove that an event never happened.

## MCP-first workflow

### The five Agent Debug session tools

These v0.7 tools add an explicit target/session workflow and are read-only with
respect to Cordis dispatch and instrumentation:

| Tool | Use |
| --- | --- |
| `cordis_list_debug_targets` | Discover active `cordis-runtime` targets and capabilities. |
| `cordis_attach_debug_session` | Attach to one exact `targetId`; returns `debugSessionId` and `targetEpoch`. |
| `cordis_debug_snapshot` | Take a bounded cold-start runtime snapshot. |
| `cordis_wait_for_runtime_change` | Wait once for a bounded, filtered metadata observation. |
| `cordis_detach_debug_session` | End one exact session and release its pending work/resources. |

Recommended cold-start sequence:

```text
cordis_list_debug_targets
        ↓ targetId + targetEpoch
cordis_attach_debug_session({ targetId })
        ↓ debugSessionId
cordis_debug_snapshot({ debugSessionId }) ──→ focused evidence tools
        ↓
cordis_wait_for_runtime_change({ debugSessionId, ... })
        ↓
cordis_detach_debug_session({ debugSessionId })
```

Record `targetId`, `targetEpoch`, and `debugSessionId` for every subsequent
call. There is one active target in v0.7. A target replacement or disposal
increments the epoch or ends the target; the old session becomes `stale` and
must not be reused. List targets and attach a new session. Do not carry old
cursors, sequence numbers, checkpoints, or profiler leases across target
incarnations. Detach ends a known session; repeated or unknown detaches produce
an MCP error. Session idle expiry,
target replacement, and Host disposal also cancel pending waits and release
session-owned experiment resources.

### The seven focused read-only tools

The original focused tools remain available and are useful after the initial
snapshot:

```text
cordis_runtime_summary
cordis_inspect_event
cordis_inspect_fiber
cordis_search_dispatches
cordis_profiler_traces
cordis_capture_checkpoint
cordis_compare_current
```

`cordis_profiler_traces` accepts an optional exact `experimentId`. These tools
remain backward-compatible and do not enable instrumentation.

## Exploring a runtime snapshot

`cordis_debug_snapshot` requires an active `debugSessionId`. It accepts optional
`sections`; the default exploration set is:

```text
summary, events, fibers, dispatches, profiler, candidates
```

The `summary` and `profiler` sections are single bounded sections. The
`events`, `fibers`, `dispatches`, and `candidates` catalogs support per-section
`catalogs` inputs with `limit` and an opaque `cursor`. Every catalog page
reports:

```text
bounded, limit, returned, total, truncated, cursor, nextCursor
```

The maximum catalog page size is 100; the default is 100. A `truncated` page
must be continued with its `nextCursor` when the Agent needs more records.
Cursors are session- and section-specific, bounded in number, and invalid
after detach, expiry, or target replacement. The profiler section only reports
retained waterfall state and never starts profiling.

`candidates` contains mechanical evidence such as duplicate live Fibers,
equivalent listener registrations, orphaned listener owners, trace `next()`
anomalies, and instrumentation conflicts. These labels do not explain why a
problem occurred or prescribe a fix.

## Waiting for runtime changes

`cordis_wait_for_runtime_change` is a normal bounded MCP request that hides the
server-side observation journal from the Agent. Its required input is
`debugSessionId`; optional filters are `afterSequence`, exact `type`, exact
`event`, and `timeoutMs`. The default timeout is 15 seconds and the maximum is
60 seconds.

Supported observation types are:

```text
dispatch-observed
topology-invalidated
profiler-trace-updated
profiler-status-changed
target-disposed
```

Use the session's returned `observationSequence`, or the latest result's
sequence, as the next `afterSequence` barrier. The result is one of:

| Outcome | Meaning |
| --- | --- |
| `found` | One matching metadata-only observation was retained. |
| `timeout` | No matching observation arrived before the bounded timeout. |
| `gap` | The requested sequence fell out of the bounded journal. |

`gap: true` is an explicit recovery signal: take a fresh
`cordis_debug_snapshot`, run focused queries as needed, then resume from the
newest sequence. A timeout or empty bounded result means only “not observed in
the retained window,” never “never happened.”

## Checkpoint and comparison

Use a caller-owned checkpoint around the user's normal edit/reload/reproduction
workflow:

```text
cordis_capture_checkpoint({ scope? })
        ↓ keep the returned JSON value
normal source edit / normal DSH reload / reproduction
        ↓
cordis_compare_current({ baseline })
```

The optional scope selects exact `eventNames` and/or `fiberNames`. A checkpoint
contains current authoritative Event/listener/live-Fiber topology and
metadata-only Effects; bounded dispatch and profiler history are excluded.

Comparison uses semantic groups rather than runtime-local ids, uids, or
registration order. Equivalent listener/Fiber multiplicities can therefore be
reported as facts such as `2 → 1`. A clean diff means no topology change was
reported in the compared scope; it is not an automatic “fixed” claim.

## Controlled waterfall profiling

Profiling is the one separately authority-gated mutation. It is not enabled by
the five session tools or by reading profiler data.

### DSH-native Agent path

The DSH tools are:

```text
cordis_start_waterfall_experiment
cordis_stop_waterfall_experiment
```

Start goes through the real DSH one-shot `ctx.approval` service and only
`allowed-once` proceeds. The returned lease has an opaque exact `leaseId`, a
finite expiry (default 15 seconds, maximum 60 seconds), and no renewal. Stop
must use that exact lease id; a stale/wrong id cannot disable a later owner.

### External MCP path

MCP has no truthful DSH Agent identity. External experiment mutation is
therefore hidden by default and requires both a non-empty bearer token and the
explicit `experiments.enabled` capability. With that capability, MCP adds:

```text
cordis_waterfall_experiment_status   # read-only
cordis_start_waterfall_experiment    # finite mutation
cordis_stop_waterfall_experiment     # exact-lease cleanup
```

When starting/stopping through an attached debug session, include its exact
`debugSessionId`; the Host associates the lease with that session and cleans it
up on detach, idle expiry, stale target, or Host disposal. Human emergency stop
and the single shared coordinator remain authoritative. Retrieve retained
traces with `cordis_profiler_traces({ experimentId: leaseId })`; retention is
bounded and is not a complete experiment log.

## Enabling MCP and authentication

The embedded Streamable HTTP MCP server is disabled by default, runs inside the
same DSH Host process, and binds only to loopback:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
      failOnStartupError: false
```

Current endpoint:

```text
http://127.0.0.1:43127/mcp
```

For external experiment mutation, configure:

```yaml
mcp:
  enabled: true
  port: 43127
  token: ${CORDIS_DEVTOOLS_MCP_TOKEN}
  experiments:
    enabled: true
```

When `token` is configured, every MCP request—including read-only requests—must
send `Authorization: Bearer <token>`. Loopback is a network exposure boundary,
not a trust boundary against other local software. The token is never placed
in tool arguments, logs, traces, checkpoints, or diagnostic output.

## JSON CLI

The package exposes `dsh-cordis-debug`, a one-shot JSON client over the same
authenticated MCP endpoint. It requires a loopback `http`/`https` endpoint and
a non-empty token. Supply connection settings with flags:

```text
dsh-cordis-debug --endpoint URL --token VALUE targets
dsh-cordis-debug --endpoint=URL --token=VALUE targets
```

Or use the environment fallbacks:

```bash
export DSH_CORDIS_DEBUG_ENDPOINT=http://127.0.0.1:43127/mcp
export DSH_CORDIS_DEBUG_TOKEN="$CORDIS_DEVTOOLS_MCP_TOKEN"
dsh-cordis-debug targets
```

Only `localhost`, `127.0.0.1`, and `[::1]` are accepted. Available commands:

```text
dsh-cordis-debug targets
dsh-cordis-debug snapshot
dsh-cordis-debug event EVENT_NAME
dsh-cordis-debug fiber --uid UID | --name FIBER_NAME
dsh-cordis-debug watch [--event EVENT_NAME] [--timeout MS]
dsh-cordis-debug checkpoint [--output FILE]
dsh-cordis-debug compare --baseline FILE
dsh-cordis-debug profile --ttl MS
```

`fiber` requires exactly one selector. `snapshot`, `watch`, and `profile`
use a transient session and always attempt to detach. `checkpoint --output FILE`
is the only command that writes a file; `compare --baseline FILE` reads a
caller-owned JSON checkpoint. `profile` performs a finite start/stop request in
one invocation and does not run a reproduction callback or arbitrary runtime
action. Output is one JSON value on stdout or one structured JSON error on
stderr; the bearer token is redacted from both.

## Installing and using the Skill

The packaged Skill is at
[skills/dsh-runtime-debugging/SKILL.md](../skills/dsh-runtime-debugging/SKILL.md)
and is included by the npm package's `skills` file entry. Install/copy that
directory into the Skill directory supported by the Agent, then enable or
reference the `dsh-runtime-debugging` Skill for a live DSH/Cordis task. It is
not the repository-development Skill under `.agents/skills`.

The Skill teaches the same cold-start sequence, focused evidence queries,
checkpoint/compare, sequence-aware waits, stale-target recovery, and approved
profiling. It requires the Agent to preserve target/session/lease ids, recover
from `gap` with a fresh snapshot, and detach when finished. If a deployed MCP
server does not advertise a required tool, report the limitation; do not invent
another name or silently substitute an operation.

## Scope and non-goals

v0.7 does not provide automatic source/plugin reload orchestration, arbitrary
Cordis event execution, generic listener/service/config mutation, persistent
approvals, lease renewal or concurrent leases, remote/LAN MCP, raw payload
capture, automatic root-cause or fix claims, breakpoints, pause/step,
expression evaluation, non-waterfall profiling, or a complete event history.
There is no raw CDP-compatible WebSocket endpoint and no CDP wire-protocol
compatibility claim. MCP, the JSON CLI, and the Skill are the supported Agent
routes.
