# Runtime Verification combined real DSH E2E

## Classification

Implemented testing strategy for v0.5 Runtime Verification.

## Change

The real DSH Web smoke now installs the dedicated runtime-verification fixture and proves one authoritative duplicate-Fiber lifecycle transition from two live copies to one.

Before the transition:

- the in-process DSH `CordisRuntime` provider captures its own caller-owned verification checkpoint through the real `cordisInspect` registry;
- an external official MCP SDK client captures a separate checkpoint through `cordis_capture_checkpoint`;
- both checkpoints observe two same-name live Fibers and two listeners for the same verification event.

The test then creates the fixture's test-only transition signal under the disposable `DSH_HOME`. The fixture disposes one live Fiber in the real Cordis runtime.

After the transition:

- DSH calls `compareCurrent` through the real `cordisInspect` provider;
- the external client calls `cordis_compare_current` through the embedded loopback MCP server;
- both paths must independently report the same semantic facts: event listener count 2 → 1, equivalent listener-group multiplicity 2 → 1, and equivalent Fiber-group multiplicity 2 → 1;
- the E2E compares only this semantic summary, not capture-local ids/uids, timestamps, or digests.

The existing Human DevTools and waterfall-profiler browser checks remain in the same DSH process after verification, so the proof also remains a regression test for the visual/debugging path.

## Boundaries

- No source-string assertions.
- No Agent/API key or model invocation is required.
- No production mutation API is added; the lifecycle transition belongs only to the E2E fixture.
- No `fixed`, root-cause, or confidence verdict is asserted.
- Profiler instrumentation semantics are unchanged.
