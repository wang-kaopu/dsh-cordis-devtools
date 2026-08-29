---
name: dsh-runtime-debugging
description: Debug a running DeepSeek Harness / Cordis runtime through its DSH DevTools MCP tools, using bounded runtime evidence, checkpoints, waits, and approved profiling; do not use for generic source-only debugging.
---

# DSH runtime debugging

Use this skill when an Agent needs to inspect or verify a live DSH/Cordis runtime. Treat the runtime as an evidence source that complements source reading, tests, and logs. Preserve the returned `targetId`, `targetEpoch`, `debugSessionId`, and any `leaseId` for the entire workflow.

## Connection prerequisite

This Skill teaches an Agent how to use an already-connected MCP surface. The
recommended connection is the package-local `dsh-cordis-devtools-mcp` stdio
bridge, which forwards the existing DSH MCP tools over an authenticated
loopback HTTP hop. It does not create another runtime registry, select a target
for the Agent, or add runtime mutation.

For an explicitly authorized setup, prepare the selected profile and token
store and let setup register the local bridge with Codex:

```bash
dsh-cordis-debug setup --profile web --agent codex
```

`setup --agent codex` executes the registration command with the local
token-file path, then returns a secret-free result. It does not restart DSH or
print the token; reload DSH through its normal workflow before debugging. The
registration shape is `codex mcp add dsh-cordis-devtools --
dsh-cordis-devtools-mcp --endpoint http://127.0.0.1:43127/mcp --token-file
<profile-token-file>`, where the placeholder is a path and must never be
replaced with token contents. This is a package-local executable path for the
current release path; do not claim or assume an `npx` package is published. If
setup or the bridge is not available, retain the manual HTTP MCP route below
and report that limitation.

After `dsh-cordis-debug rotate-token --profile web`, wait for the user to
reload DSH through its normal workflow. An already-running bridge may still
hold its old remote connection. If the first tool request after reload fails,
the Agent may explicitly retry that same request once; this is when the bridge
reconnects and rereads the token file. Never automatically retry or replay a
tool call, and do not issue more than that one explicit retry. If it fails
again, report the failure and use `doctor`/connection diagnostics.

The Skill does not silently enable the DSH plugin, create a host connection, or
supply credentials during an ordinary debugging task. Before using it, the
DSH profile must enable `dsh-cordis-devtools` MCP and the Agent host must have
either the stdio bridge or the manual Streamable HTTP endpoint configured:

```text
http://127.0.0.1:43127/mcp
```

When the DSH MCP configuration has a token, configure that token in the Agent host's secret or environment facility. The model must never receive the token in a task, prompt, Skill input, tool argument, log, checkpoint, or source file. The MCP client, rather than the model, sends `Authorization: Bearer ...`.

For the manual HTTP route, set `CORDIS_DEVTOOLS_MCP_TOKEN` in the environment
that launches Codex, then register the endpoint once:

```bash
codex mcp add dsh-cordis-devtools --url http://127.0.0.1:43127/mcp --bearer-token-env-var CORDIS_DEVTOOLS_MCP_TOKEN
```

Reload the Agent host after changing its MCP configuration. Confirm the connection through tool discovery: `cordis_list_debug_targets` and the other DSH tools must be available before starting a workflow. If the discoverable protocol primitives are available, call `cordis_devtools_get_protocol` first and use its Schema/Target/Cordis/Fiber/Profiler descriptions to choose commands. If the tools are absent, report the connection/configuration limitation and stop; do not construct raw HTTP requests, ask the user to paste a token into chat, or substitute the JSON CLI for an unavailable native MCP tool.

## Tool availability and safety

The generic protocol primitives are:

- `cordis_devtools_get_protocol`
- `cordis_devtools_list_targets`
- `cordis_devtools_attach`
- `cordis_devtools_send`
- `cordis_devtools_read_events`
- `cordis_devtools_wait_for_event`
- `cordis_devtools_detach`

They are an MCP adapter over the same Agent Debug Core. Use the returned
schema to discover command names, keep the exact `sessionId` and
`targetEpoch`, and recover from `gap` with a fresh `Cordis.getSnapshot`. The
protocol is CDP-shaped in message organization only; it is not Chrome CDP.
An optional native WebSocket endpoint exists only when the Host explicitly
enables `protocol.websocket`; it is loopback-only and shares the bounded Core
journal.

The session workflow uses these tools exactly:

- `cordis_list_debug_targets`
- `cordis_attach_debug_session`
- `cordis_debug_snapshot`
- `cordis_wait_for_runtime_change`
- `cordis_detach_debug_session`

Focused evidence tools are:

- `cordis_runtime_summary`
- `cordis_inspect_event`
- `cordis_inspect_fiber`
- `cordis_search_dispatches`
- `cordis_profiler_traces`
- `cordis_capture_checkpoint`
- `cordis_compare_current`
- `cordis_waterfall_experiment_status`
- `cordis_start_waterfall_experiment`
- `cordis_stop_waterfall_experiment`

Tool availability may vary by deployed project version. If a requisite MCP tool is absent, report that limitation and stop or ask the user; do not invent an alternative tool name or silently substitute a different operation.

This skill is observational and verification-oriented. It does not authorize arbitrary dispatch, runtime mutation, reload, breakpoint/evaluation, or payload capture. Do not bypass DSH one-shot approval, the MCP bearer token, or the configured experiment capability. Start profiling only after the user authorizes it and the applicable approval/capability check succeeds. Always detach with `cordis_detach_debug_session` when finished, even after a failed or partial workflow. Stop an experiment with its exact returned `leaseId`; retain the id so stale-stop behavior and cleanup remain verifiable.

Never claim an automatic root cause, `fixed` result, confidence score, or successful remediation from these tools. Candidates and comparisons are mechanical facts. Do not treat a bounded absence as proof that something never happened.

## Cold-start workflow

1. Call `cordis_list_debug_targets` and select the active `cordis-runtime` target. Record its `targetId`, `targetEpoch`, status, and capabilities.
2. Call `cordis_attach_debug_session` with that target. Record the opaque `debugSessionId` and the session's target epoch.
3. Call `cordis_debug_snapshot` with the session and the sections needed for exploration, normally `summary`, `events`, `fibers`, `dispatches`, `profiler`, and `candidates`. Use the returned bounded catalog facts, names, multiplicities, and owner relationships to choose focused queries.
4. Use the focused evidence tools with exact event names, Fiber uids/names, and bounded limits. Keep the session id on every new session-aware request.
5. Finish with `cordis_detach_debug_session` and report any stale, gap, truncated, or bounded facts alongside the evidence.

## Evidence workflows

### Duplicate Fibers or listeners

Start with `cordis_debug_snapshot` sections `fibers`, `events`, and `candidates`. For a candidate, confirm current authoritative state with `cordis_inspect_fiber` and `cordis_inspect_event`. Compare semantic owner/name/registration facts and multiplicities; runtime-local ids and uids can change between captures. Report “multiple live Fibers” or “equivalent registrations observed” only as evidence, not as a cause.

### Lifecycle leak before/after

Call `cordis_capture_checkpoint` before the user's normal edit, reload, or reproduction step and retain the complete checkpoint value. After that user-directed action, call `cordis_compare_current` with the baseline. Describe semantic Event/Listener/Fiber multiplicity and ownership changes, including `2 -> 1` or `1 -> 2` where supplied. A clean diff is evidence of no reported topology change in the compared scope; it is not an automatic fixed claim.

### Bounded waits and missing observations

Use `cordis_wait_for_runtime_change` with an explicit `debugSessionId`, bounded timeout, exact observation type/event filter when useful, and `afterSequence` from the session or previous result. A timeout or empty retained search means “not observed in the bounded window,” never “never happened.”

Inspect the returned journal window. If `gap` is true or `afterSequence` is older than the retained window, recover by calling `cordis_debug_snapshot` and focused evidence queries to establish a fresh state, then resume waiting from the newest returned sequence. Do not infer an event that was dropped or expired.

### Waterfall profiling

Before mutation, call `cordis_waterfall_experiment_status` and check ownership/capability facts. Explain the finite profiling purpose and obtain the user's authorization. Call `cordis_start_waterfall_experiment` with a bounded TTL; save the exact returned `leaseId` (and experiment id if distinct). Reproduce only the requested behavior, then call `cordis_profiler_traces` filtered to that experiment. Repeated or late `next()` calls are observed trace behavior to report with event/listener/timing metadata; they are not by themselves a root cause.

Call `cordis_stop_waterfall_experiment` with the exact lease id as soon as the finite observation is complete, then re-check `cordis_waterfall_experiment_status`. If the process or session disappears, rely on the coordinator's exact-owner/TTL cleanup and report whether cleanup was observed; never use a stale lease id to stop a later owner. Human ownership or a busy/unsupported/conflict result is a factual stop condition.

## Stale targets and sessions

If a target reload or disposal changes its `targetEpoch`, or a tool reports a stale/expired/detached session, stop using that session and retain its ids for the report. Call `cordis_list_debug_targets` again, select the new active target, attach a new session, and take a fresh `cordis_debug_snapshot`; do not silently reuse an old checkpoint, cursor, sequence, or lease as if it belonged to the new target. If detachment or host disposal cancels a wait, report that lifecycle fact and clean up any still-owned exact lease when possible.

## Handoff

Summarize the target/session identity, time and bounded windows, exact queries, raw mechanical facts, gaps/truncation, and any profiler lease/cleanup outcome. Keep source-level diagnosis and remediation decisions separate from runtime evidence. Detach the debug session before handing control back to the user.
