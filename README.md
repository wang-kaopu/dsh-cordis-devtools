<div align="center">

# DSH DevTools for Agents

**Let your coding Agent see the Cordis runtime it is changing.**

[English](README.md) · [简体中文](README-zh.md)

</div>

A coding Agent can read your plugin source, but it usually cannot see the Cordis runtime state that source actually produces inside DSH.

That leaves a clear **evidence gap**: Did DSH really load the change? Was an Event registered more than once? Is an old Fiber still alive? What actually changed in the runtime after the fix?

DSH DevTools exposes that runtime information to the Agent. The Agent can inspect the current state before making a change, wait for a target behavior during reproduction, and compare the runtime before and after reload.

| Debugging question | Evidence from DevTools |
| --- | --- |
| What changed in the runtime after reload? | checkpoint + semantic topology comparison |
| Why does an Event appear to run twice? | live listener registrations, multiplicity, and owning Fibers |
| Is an old plugin instance still alive? | current live Fiber topology |
| Did the target behavior occur during reproduction? | recent dispatch records and filtered runtime waits |
| What happened inside a waterfall chain? | profiler traces with listener spans, timing, and `next()` records |

A typical Agent debugging loop:

```text
inspect runtime
    ↓
capture checkpoint
    ↓
edit plugin
    ↓
normal reload + reproduce
    ↓
wait / inspect current runtime
    ↓
compare checkpoint
```

Code changes and reloads continue through the normal development workflow. DSH DevTools narrows the evidence gap between source code and the live runtime, giving the Agent concrete process state to work from.

## Get started

### 1. Add DevTools to a DSH Web profile

Install the `v0.8.0` release directly from GitHub:

```bash
dsh plugin --profile web add github:wang-kaopu/dsh-cordis-devtools#v0.8.0
```

You can then open **Cordis DevTools** from the DSH Web sidebar footer and inspect the current runtime directly.

For repository development, clone the source and use the local package instead:

```bash
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add ./
```

### 2. Connect Codex or another MCP host

Configure the target DSH profile and register the profile-local stdio bridge:

```bash
dsh plugin --profile web exec dsh-cordis-debug setup --profile web --agent codex
```

Reload DSH through your normal development workflow, then check the connection:

```bash
dsh plugin --profile web exec dsh-cordis-debug doctor --profile web
```

`setup` creates an owner-only token file for the selected profile, enables the local loopback MCP endpoint, and registers the DevTools bridge with Codex.

The stdio bridge reads the credential locally and forwards MCP requests to the running DSH process. The token does not need to enter prompts, tool arguments, logs, or diagnostic results.

For other MCP-capable hosts, use the bridge command printed by `setup` or see the [MCP connection guide](docs/agent-runtime-diagnostics.md#connecting-an-mcp-capable-agent).

### 3. Let the Agent inspect, change, and verify

You can give the Agent a task with an explicit runtime verification step:

> Inspect the current Cordis runtime and capture a checkpoint before changing this plugin. After I reload DSH and reproduce the issue, compare the current runtime and base your conclusion only on the retained runtime evidence.

A typical session looks like this:

```text
list targets
    ↓
attach session
    ↓
snapshot / focused inspection
    ↓
capture checkpoint
    ↓
edit code + normal reload + reproduce
    ↓
wait / inspect current runtime
    ↓
compare checkpoint
    ↓
detach session
```

The optional [runtime-debugging Skill](skills/dsh-runtime-debugging/SKILL.md) provides the full Agent workflow, including cursor handling, stale sessions, gap recovery, and lease cleanup.

## Interfaces

### Agent tools

| Purpose | Tools |
| --- | --- |
| Session lifecycle | `cordis_list_debug_targets`, `cordis_attach_debug_session`, `cordis_debug_snapshot`, `cordis_wait_for_runtime_change`, `cordis_detach_debug_session` |
| Focused runtime inspection | `cordis_runtime_summary`, `cordis_inspect_event`, `cordis_inspect_fiber`, `cordis_search_dispatches`, `cordis_profiler_traces` |
| Runtime verification | `cordis_capture_checkpoint`, `cordis_compare_current` |
| Waterfall experiment | `cordis_waterfall_experiment_status`, `cordis_start_waterfall_experiment`, `cordis_stop_waterfall_experiment` |

Sessions, snapshots, waits, focused diagnostics, and verification are read-only paths.

Waterfall experiment tools are exposed when the required authentication and capability settings are enabled.

### Human DevTools

The DSH Web sidebar provides four views:

- **Events** — live Event registrations, listener order, ownership, and Event → Fiber navigation;
- **Timeline** — recent observer dispatch metadata;
- **Fibers** — live Fiber topology, ownership, Effects, and recent dispatch context;
- **Profiler** — waterfall traces and explicit profiling instrumentation controls.

The Human UI and Agent interfaces use the same Host runtime state.

### JSON CLI

The same debugging surface is also available through the `dsh-cordis-debug` CLI:

```bash
dsh plugin --profile web exec dsh-cordis-debug targets
dsh plugin --profile web exec dsh-cordis-debug snapshot
dsh plugin --profile web exec dsh-cordis-debug checkpoint --output checkpoint.json
dsh plugin --profile web exec dsh-cordis-debug compare --baseline checkpoint.json
```

See the [CLI reference](docs/agent-runtime-diagnostics.md#json-cli) for the complete command set.

### Manual loopback MCP

Hosts that cannot launch the stdio MCP server directly can connect to the embedded loopback MCP endpoint inside the DSH process:

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
```

Endpoint:

```text
http://127.0.0.1:43127/mcp
```

Read-only local debugging can run without a token.

External waterfall experiments additionally require authentication and an explicit experiment capability.

See [MCP authentication](docs/agent-runtime-diagnostics.md#enabling-mcp-and-authentication).

## How it works

DSH DevTools collects Cordis runtime information inside the DSH process, keeps that state in the Host, and exposes it through MCP, the CLI, DSH integrations, and the Web UI.

```text
                           Live Cordis runtime
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
          ObserverCollector              Waterfall instrumentation
          topology + dispatch                 opt-in
                 │                                 │
                 ▼                                 ▼
             snapshots                    WaterfallTraceStore
                 │                                 │
                 └──────────────┬──────────────────┘
                                ▼
                         DevtoolsService
                         Host-owned state
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
          AgentDebugService          RuntimeDiagnosticsQuery
        session / snapshot /          focused query /
        wait / experiment lease      checkpoint / compare
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                MCP / CLI / Skill / DSH / Web UI
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                  Agent                   Human
```

`DevtoolsService` is the Host-side composition point for runtime collection, recent history, runtime notifications, verification, and profiling coordination.

`AgentDebugService` provides the Agent-facing debugging lifecycle, including targets, sessions, snapshots, cursors, waits, and experiment leases.

`RuntimeDiagnosticsQuery` provides focused Event, Fiber, dispatch, and profiler-trace queries, along with checkpoint capture and semantic comparison.

MCP, the CLI, DSH integrations, and Web DevTools all read from this shared Host runtime state, so each interface sees the same Cordis runtime.

### Observer path

The default observer path reads the current Cordis state and keeps a recent runtime history.

It provides:

- live Event and listener registrations;
- listener order, registration metadata, and owning Fiber;
- current live Fiber topology;
- recent dispatch metadata;
- runtime snapshots;
- focused Event / Fiber / dispatch / trace queries;
- checkpoint capture and before/after comparison;
- a runtime change journal that Agents can wait on.

Observer collection is limited to debugging metadata. It does not include Event arguments, return values, prompts, tool results, file contents, plugin configuration, tokens, or credentials.

### Runtime evidence

Dispatches, profiler traces, and runtime change observations all have explicit retention windows. Older records are gradually evicted as new data arrives.

Query results include the corresponding window state:

- `timeout`: no matching change was observed in the current window;
- `gap`: the current cursor has fallen behind the retained window and a fresh snapshot is required;
- checkpoint comparison: reports semantic changes between two runtime states.

For example:

```text
listener multiplicity: 2 → 1
Fiber "foo": removed
Event "bar": listener group added
```

These results can be used directly as evidence for further Agent analysis. Root cause, confidence, and whether a fix is actually correct are left to the Agent to determine from the source and runtime state together.

### Controlled waterfall profiling

The observer path covers topology, registrations, and dispatch-level questions. Per-listener timing and waterfall `next()` behavior require temporary instrumentation inside the execution chain.

For those cases, DevTools can run a finite waterfall experiment:

```text
Agent / Human
     │
     ▼
WaterfallExperimentCoordinator
     │ exact owner + finite lease
     ▼
WaterfallInstrumentationController
     │
     ▼
WaterfallTraceStore
```

`WaterfallExperimentCoordinator` owns profiling coordination.

An Agent experiment receives a `leaseId` with a finite TTL. The lease expires automatically, and an explicit stop must match the active `leaseId`. Human DevTools can trigger an emergency stop at any time.

The profiler records profiling metadata such as Event identity, listener ownership, timing, outcome, and `next()` behavior. Business payloads are not retained.

## Documentation

- [Architecture and invariants](docs/architecture.md)
- [Agent runtime diagnostics guide](docs/agent-runtime-diagnostics.md)
- [Controlled runtime experiments](docs/v0.6-controlled-runtime-experiments.md)
- [Runtime verification design](docs/v0.5-runtime-verification.md)
- [Development workflow](docs/development-workflow.md)

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify:policy
pnpm typecheck
pnpm test
pnpm build
pnpm verify:client-bundle
pnpm test:e2e:web
```

Prefer the smallest check set that covers the current change.

Repository conventions and durable design decisions live in [AGENTS.md](AGENTS.md) and [.agents/notes](.agents/notes/README.md).

## License

Apache-2.0
