# Agent Note: External MCP against a real DSH Host

Status: implemented

## Problem

The MCP adapter has a real SDK Client integration test over an in-process diagnostics fixture, but that does not prove the plugin config path starts the endpoint inside a real DSH process or that an external client can reach that exact running Host instance. Wave E also requires an external Agent to observe a runtime-only duplicate-registration shape rather than merely list tools and read a summary.

## Decision

Extend the disposable real DSH Web smoke in a stacked test branch. The smoke allocates a second loopback port, writes a temporary DSH patch that enables `dsh-cordis-devtools` MCP on that port, installs the shared E2E-only `agent-debugging-probe`, and launches the normal Web profile with the patch.

The runtime fixture creates two distinct same-name live Fibers. Each Fiber owns one listener for `cordis-devtools-e2e/duplicate-listener` and periodically dispatches that event.

Before browser assertions, the test waits for the MCP TCP listener and connects from the test process with the official `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`. It then verifies:

- the exact five read-only MCP tools;
- `cordis_runtime_summary` reports bounded observer evidence while profiler instrumentation remains disabled;
- `cordis_inspect_event` reports exactly two current listeners with two distinct live owner uids and one shared owner name;
- `cordis_inspect_fiber` by the observed owner name returns both live Fibers and by uid resolves each authoritative instance with ownership of the duplicate event;
- `cordis_search_dispatches` remains explicitly bounded and includes a recent duplicate-event record with `registeredListeners=2`.

The rest of the existing Web/Profiler smoke remains unchanged, so the same process proves human UI and external MCP access can coexist over one runtime.

## Alternatives considered

- Treat the lower-level MCP integration test as sufficient. Rejected because it does not exercise DSH config/effect lifecycle or prove cross-process access to the real Host.
- Stop at MCP tool discovery plus `runtimeSummary`. Rejected because that proves transport reachability but not the runtime-only debugging value that Wave E exists to demonstrate.
- Start a standalone MCP process. Rejected because the product requirement is to inspect the already-running DSH runtime.
- Use curl/raw JSON-RPC. Rejected because a real official MCP Client provides better protocol compatibility evidence.
- Treat dispatch-context Fiber identity as listener ownership. Rejected because listener ownership is a current registry fact, whereas dispatch context identifies the context that initiated a retained dispatch.

## Consequences

The E2E now proves the exact external-agent boundary and the duplicate-Fiber debugging evidence chain without requiring Codex/Claude credentials. Current listener/Fiber state is authoritative; recent dispatch data stays explicitly bounded and only confirms that the event was observed while two listeners were registered. The test also keeps the existing human UI/profiler smoke on the same DSH process.
