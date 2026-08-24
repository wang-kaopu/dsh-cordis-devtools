# Agent Note: External MCP against a real DSH Host

Status: implemented

## Problem

The MCP adapter has a real SDK Client integration test over an in-process diagnostics fixture, but that does not prove the plugin config path starts the endpoint inside a real DSH process or that an external client can reach that exact running Host instance.

## Decision

Extend the disposable real DSH Web smoke in a stacked test branch. The smoke allocates a second loopback port, writes a temporary DSH patch that enables `dsh-cordis-devtools` MCP on that port, and launches the normal Web profile with the patch.

Before browser assertions, the test waits for the MCP TCP listener, connects with the official `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`, verifies the exact five read-only tools, and calls `cordis_runtime_summary`. The result must expose bounded observer evidence and a disabled profiler state from the running DSH process.

The rest of the existing Web/Profiler smoke remains unchanged, so the same process proves human UI and external MCP access can coexist over one runtime.

## Alternatives considered

- Treat the lower-level MCP integration test as sufficient. Rejected because it does not exercise DSH config/effect lifecycle or prove cross-process access to the real Host.
- Start a standalone MCP process. Rejected because the product requirement is to inspect the already-running DSH runtime.
- Use curl/raw JSON-RPC. Rejected because a real official MCP Client provides better protocol compatibility evidence.

## Consequences

The E2E now proves the exact external-agent boundary without requiring Codex/Claude credentials. It adds one temporary loopback listener and patch file inside the disposable test home, both cleaned up with the DSH process/test directory.
