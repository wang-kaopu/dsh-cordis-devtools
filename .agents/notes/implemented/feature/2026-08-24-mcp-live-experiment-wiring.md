# Agent Note: MCP live controlled experiment wiring

Status: implemented

## Problem

The embedded MCP server already had bearer authentication and capability-gated experiment tools, but plugin config did not expose those options and the server had not been connected to the live `DevtoolsService` coordinator.

## Decision

`McpConfig` gains an optional bearer `token` and optional `experiments.enabled` capability flag.

Experiment capability is itself explicit opt-in. When `mcp.experiments` is omitted, the v0.5 seven-tool read-only MCP surface remains unchanged. When `mcp.experiments` is present with mutation disabled, the live `DevtoolsService` coordinator is exposed through a narrow transport adapter so read-only ownership status is available. When `mcp.experiments.enabled` is true, authenticated start/stop are additionally exposed.

The adapter only renames the service's factual `waterfallExperimentStatus()` method to the MCP transport contract's `status()` and delegates exact `startAgent('mcp', ...)` / `stopAgent(...)`. It owns no lease, timer, conflict state, or instrumentation state.

The MCP server's existing validation remains authoritative: enabling mutation requires a non-empty bearer token and a control. When a token is configured it protects every request on the loopback endpoint, not only mutating calls.

## Alternatives considered

### Enable MCP experiments automatically whenever MCP itself is enabled

Rejected. v0.5-compatible read-only configurations must not silently gain mutation or even a changed default tool manifest.

### Always expose experiment status when MCP itself is enabled

Rejected after real DSH Web compatibility verification. Existing read-only integrations may rely on the exact seven-tool manifest; experiment visibility therefore begins only when `mcp.experiments` is explicitly present.

### Add a generic `status()` alias to `DevtoolsService`

Rejected. The Host service already has the domain-specific `waterfallExperimentStatus()` API. A tiny MCP adapter keeps transport naming out of the core service surface.

### Protect only start/stop tool calls with the token

Rejected. Authentication at the HTTP boundary is simpler and avoids exposing a mixed authenticated/unauthenticated protocol session once an operator has configured a token.

### Give MCP a second experiment controller

Rejected. Human, DSH, and MCP must share the service-owned coordinator.

## Consequences

Existing `mcp.enabled: true` configurations preserve their prior read-only tool surface. Operators can opt into read-only experiment ownership visibility with `mcp.experiments: { enabled: false }`, or authenticated mutation with `enabled: true` plus a bearer token. The MCP adapter remains transport-only: all ownership, TTL, exact-stop, conflict, and cleanup semantics stay in the shared coordinator.

## Verification

A focused integration test uses a real `@deepseek-ai/cordis` Context, real `DevtoolsService`, the thin MCP control adapter, official MCP SDK Client, authenticated start, a real waterfall dispatch, exact lease trace attribution, status read, and exact stop. Existing MCP authority tests continue to cover missing/wrong bearer credentials, hidden mutation tools by default, and secret non-disclosure. Real DSH Web smoke additionally pins the unchanged default seven-tool manifest when experiment capability is omitted.

The shared query already supports exact `experimentId` filtering. The final combined E2E must ensure the externally exposed profiler-trace tool carries that same filter; if adapter schema parity is missing, it is a release-blocking integration gap rather than permission to infer traces by timestamp.
