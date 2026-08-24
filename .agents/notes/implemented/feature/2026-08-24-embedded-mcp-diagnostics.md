# Agent Note: Embedded MCP runtime diagnostics

Status: implemented

## Problem

External coding agents such as Codex, Claude Code, and Cursor run outside the DSH Host process. Reading source, logs, or DSH API catalogs cannot prove current runtime-only facts such as duplicate live listener registrations, authoritative Fiber ownership, lifecycle residue, or bounded dispatch observations.

A standalone MCP process that starts another Cordis runtime would inspect the wrong system. External agents need a standard protocol endpoint owned by the DSH process that is already running the target Cordis runtime.

## Decision

Add an optional embedded Model Context Protocol server backed by the shared `RuntimeDiagnosticsQuery`. When explicitly enabled in plugin config, the running Host binds a Streamable HTTP MCP endpoint to `127.0.0.1` only. The first configured default port is `43127`; the lower-level start helper also accepts port `0` for deterministic ephemeral-port tests.

The server uses the official `@modelcontextprotocol/sdk` as a production dependency and keeps it external to the Node bundle. The declared baseline is `^1.30.0`, matching the SDK release used by typecheck and the real Client/Streamable HTTP integration suite. The repository intentionally does not track a `pnpm-lock.yaml`, so the package manifest is the dependency source of truth.

Each stateless Streamable HTTP request creates a protocol server/transport pair over the same live diagnostics query source and closes that pair after the response. The owning Cordis effect closes the HTTP listener and active protocol resources during plugin disposal.

The first MCP surface is read-only and exposes five tools:

- `cordis_runtime_summary`;
- `cordis_inspect_event`;
- `cordis_inspect_fiber`;
- `cordis_search_dispatches`;
- `cordis_profiler_traces`.

Tool definitions carry MCP read-only/idempotent/closed-world annotations. Successful calls return the canonical diagnostics object as `structuredContent` plus a JSON text fallback. Tool-domain validation failures become MCP tool errors rather than changing the runtime.

MCP is disabled by default. Enabling it is an explicit configuration choice. Listener bind/startup failure is surfaced through an explicit error log but, by default, is contained to the optional MCP surface so the observer and human DevTools remain available. `mcp.failOnStartupError: true` upgrades the same failure into plugin-activation failure for deployments that require MCP availability. Neither mode silently chooses another host or port. No non-loopback host option exists in this slice.

## Alternatives considered

- Standalone stdio MCP server. Rejected because it would need a second IPC mechanism to reach the already-running DSH runtime and otherwise observes the wrong Cordis instance.
- Route external agents through the browser RPC channel. Rejected because that transport is browser-oriented and not a standard coding-agent protocol.
- Make DSH's own Agent reconnect through this MCP endpoint. Rejected because in-process DSH already has the narrower Cordis Inspect extension point and should not depend on a loopback HTTP hop.
- Expose profiler enable/disable tools immediately. Rejected because instrumentation changes dispatch behavior and requires a separate permission/lease design.
- Allow configurable `0.0.0.0`/LAN binding. Rejected for the first slice because runtime metadata should not be remotely exposed by default and no remote authentication model has been approved.
- Always fail plugin activation when the MCP port is unavailable. Rejected because MCP is an optional Agent adapter and should not remove the already-working observer/UI path unless the operator explicitly requests fail-fast behavior.
- Advertise an older unverified MCP SDK minimum. Rejected because the package should not claim compatibility below the exact Streamable HTTP/tool-result API baseline exercised by CI.

## Consequences

External MCP clients can inspect the same live runtime as the human DevTools and DSH-native Cordis Inspect adapter while sharing one query implementation. Running an MCP endpoint adds a local TCP listener only when explicitly enabled and adds the official MCP SDK as a runtime dependency. A port conflict disables only MCP by default and remains visible in Host logs; deployments that require the endpoint can opt into fail-fast activation. The first slice remains read-only and metadata-only; other local processes can still reach the loopback endpoint, so stronger authentication is a possible follow-up before any broader exposure is considered.
