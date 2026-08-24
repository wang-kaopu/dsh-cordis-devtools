# Agent Note: MCP controlled experiment authority

Status: implemented

## Problem

External MCP clients do not have a trustworthy DSH Agent/session identity and therefore cannot use the in-process `ctx.approval` seam. At the same time, loopback-only networking is not an authority boundary against other local processes, so exposing waterfall mutation on the existing unauthenticated read-only endpoint would silently broaden v0.5's trust model.

## Decision

The embedded MCP server gains two independent controls:

- optional `token`: when configured, **every** MCP request requires exact `Authorization: Bearer <token>` before request-body parsing or MCP protocol dispatch;
- optional experiment capability: a shared experiment control may expose read-only status, while mutating start/stop tools are listed only when `experiments.enabled === true`.

Enabling experiment mutation requires both a non-empty bearer token and a live experiment control. Invalid capability configuration fails before the listener starts. There is no fallback to unauthenticated mutation and no attempt to construct or impersonate a DSH Agent for approval.

The protocol tools are:

- `cordis_waterfall_experiment_status` — read-only/idempotent, present whenever a control is supplied;
- `cordis_start_waterfall_experiment` — mutating, non-idempotent, present only under explicit capability;
- `cordis_stop_waterfall_experiment` — mutating cleanup, present only under explicit capability.

Start delegates with source `mcp`; stop carries only the exact lease id. The server remains fixed to `127.0.0.1`. The bearer token is transport authority only and is never passed to diagnostics/control, returned in structured output, or logged by the server.

The first Wave F implementation accepts an abstract control in internal server options. The later H2 integration maps user config (`mcp.token` + `mcp.experiments.enabled`) to the real shared coordinator; production config does not expose a way to supply a fake control.

## Alternatives considered

### Route external MCP mutation through `ctx.approval`

Rejected. MCP connections do not own a real DSH Agent/session/call identity. Fabricating one would undermine the approval seam's exact-agent routing and durable session audit semantics.

### Treat loopback access as sufficient permission

Rejected. Another process running as the same local user can reach loopback. Mutation therefore requires an explicit capability plus a secret, even though read-only MCP remains backward compatible when no token is configured.

### Put the bearer token in tool arguments

Rejected. Tool arguments are model-visible/runtime data and would risk transcript/log leakage. Authority belongs to the HTTP transport header before MCP dispatch.

### Protect only start/stop requests with the token

Rejected. A single endpoint with mixed authentication makes client behavior surprising and creates an easy future bypass when new mutating methods are added. Once `token` is configured it consistently protects every MCP request.

### Always list mutation tools and reject their calls when disabled

Rejected. Capability discovery should reflect actual authority. Hidden-by-default tools prevent an Agent from planning around an operation that the deployment never enabled.

## Consequences

Existing v0.5 config (no token, no experiment control/capability) still exposes exactly the original seven read-only tools. A status-only control can add factual experiment ownership without mutation. Authenticated capability tests use the official MCP SDK Client and verify missing/wrong credentials fail before any control mutation.

The later plugin-entry integration must require a configured token whenever `mcp.experiments.enabled` is true and must never print that token while logging the endpoint.
