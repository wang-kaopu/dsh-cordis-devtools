# Agent Note: v0.6 controlled runtime experiments real DSH E2E

Status: implemented

## Problem

v0.6 had focused proofs for the coordinator, trace tagging, DSH approval tools, MCP authority, live adapter wiring, and Human ownership UI, but no single real DSH process proved that those adapters share one authoritative owner. The MCP profiler adapter also exposed `event` and `limit` while the shared query already supported exact `experimentId`, so an external Agent could start a lease but could not transport-select only traces owned by that lease.

## Decision

Keep the existing v0.5 runtime-verification Web smoke unchanged as a regression and add a second keyless real DSH smoke dedicated to controlled experiments.

The controlled smoke installs a small fixture into the shipped DSH Web profile. The fixture consumes the real `tools`, `approval`, and `cordisDevtools` services; it never mounts a mock ToolRuntime or approval service. A fake Agent value supplies only the open-turn session shape required by the real ApprovalService, while a real `approval/request` listener deterministically returns `unavailable`, `rejected`, or `allowed-once`.

Through the real `ctx.tools.execute()` path the fixture proves denied starts do not mutate instrumentation, an approved start creates a DSH-owned finite lease, a real Cordis waterfall trace carries that exact lease id, stale stop is non-mutating, and exact stop disables the lease. The fixture then keeps one metadata-only waterfall event firing periodically so the same process can exercise MCP and Human ownership.

The outer smoke explicitly enables authenticated MCP experiments. It proves missing/wrong bearer credentials fail at the HTTP boundary, an official MCP Client can start an MCP lease, exact `experimentId` trace filtering returns only that lease's traces, stale stop cannot mutate ownership, Human DevTools can emergency-stop the MCP lease, finite TTL cleanup works for a later lease, and ordinary Human profiling remains usable afterward.

`cordis_profiler_traces` therefore adds optional `experimentId` to its MCP input schema and delegates it unchanged to `RuntimeDiagnosticsQuery.profilerTraces`. This closes transport parity without adding a second filtering implementation.

## Alternatives considered

### Extend the existing v0.5 Web smoke in place

Rejected. Runtime Verification and controlled mutation have different failure surfaces. Two sequential real DSH smokes keep the older read-only seven-tool regression intact and make authority failures easier to locate.

### Test DSH start by calling `DevtoolsService.startAgent()` directly

Rejected. That would bypass the actual ToolRuntime and ApprovalService boundary that v0.6 exists to protect.

### Infer MCP-owned traces from event name or timestamps

Rejected. `experimentId = leaseId` is the approved attribution contract. The MCP adapter must expose the exact shared-query filter instead of reconstructing correlation heuristically.

### Use a source-string assertion for MCP schema or UI ownership

Rejected. The official MCP Client and real DSH Web browser path exercise the actual protocol and DOM behavior.

## Consequences

`pnpm test:e2e:web` now runs two disposable DSH Web processes sequentially: the established read-only/runtime-verification smoke and the controlled-experiment smoke. CI is slower, but each process has one coherent responsibility and no model/API credentials are required.

The default MCP configuration remains unchanged: omitting `mcp.experiments` still exposes exactly the v0.5 seven read-only tools. The second smoke explicitly opts into bearer-authenticated experiment capability and therefore expects the three additional experiment tools.

The MCP profiler schema gains only an optional exact metadata filter; no raw payload, return value, error detail, token, or persistent lease state is added.

## Verification

- focused MCP integration calls `cordis_profiler_traces` through the official SDK Client with an exact `experimentId`;
- the fixture drives real DSH ToolRuntime + ApprovalService outcomes and real Cordis waterfall dispatch;
- the controlled Web smoke proves DSH approval, MCP auth/start/status/trace/stop/TTL, stale-stop safety, Human emergency stop, and post-Agent Human profiling in one real DSH process;
- the existing runtime-verification Web smoke continues to pin the default seven-tool MCP surface and v0.5 2 → 1 verification behavior;
- full policy, typecheck, unit/integration tests, build, client-bundle verification, and both real DSH Web smokes must pass before merge.
