# Agent Note: MCP Runtime Verification adapter

Status: implemented

## Problem

External coding agents need the same v0.5 checkpoint/compare capability as in-process DSH Agents, against the already-running DSH Host. The embedded MCP adapter must expose that capability without reimplementing checkpoint or diff semantics.

## Decision

Add two read-only MCP tools to the existing loopback Streamable HTTP server:

- `cordis_capture_checkpoint`;
- `cordis_compare_current`.

The capture tool accepts the same optional exact-name scope as Runtime Diagnostics Query. The compare tool accepts the complete caller-owned baseline checkpoint. MCP validates protocol argument shape only, then delegates to `RuntimeDiagnosticsQuery`, which owns schema/digest validation, fresh-current capture, and semantic comparison.

Both tools retain the existing read-only/idempotent/closed-world annotations. The MCP listener remains disabled by default and loopback-only.

## Alternatives considered

- Add a standalone checkpoint store inside the MCP server. Rejected because v0.5 checkpoints are caller-owned and the running Host should not own TTL/persistence state.
- Reimplement comparison in MCP. Rejected because DSH and external agents must observe the same canonical verification semantics.
- Add profiler mutation while extending the MCP surface. Rejected because v0.5 remains read-only and controlled experiments are deferred.

## Consequences

The embedded MCP surface grows from five to seven tools. Official MCP SDK Client tests verify exact result parity between MCP and direct Runtime Diagnostics Query for checkpoint capture and comparison. No new network exposure, target-runtime mutation, persistence, or sensitive payload capture is introduced.
