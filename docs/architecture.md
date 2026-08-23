# Architecture

## Purpose

`dsh-cordis-devtools` observes the live Cordis runtime used by DeepSeek Harness and exposes stable snapshots for developer tooling. The project starts observer-first: inspection must not change the behavior being inspected.

## Layers

```text
Cordis runtime
    │
    ▼
src/host/cordis-adapter.ts
    │  isolates Cordis internal/experimental access
    ▼
src/host/collector.ts
    │  owns bounded observation state
    ▼
src/shared/types.ts
    │  transport/presentation-neutral snapshots
    ├──────────────► future CLI/export
    ▼
src/client/
       Web presentation
```

### Host adapter

`cordis-adapter.ts` is the only normal location for direct dependence on unstable Cordis implementation details such as listener registry storage. When Cordis changes an internal field, repair the adapter and keep downstream types stable where possible.

### Collector

The collector listens to authoritative Cordis lifecycle and dispatch signals and owns bounded in-memory history. It does not interpret an event start signal as an event completion signal and does not claim timing data Cordis did not expose.

### Shared model

`src/shared` describes facts the collector can support. A shared field is an observability contract: adding a field requires a reliable source, clear unknown/null semantics, and a decision about whether it is safe to expose to clients.

### Client

The client renders snapshots and eventually subscribes to updates through a DSH-supported data plane. It must not reach through shared APIs into host `ctx.events`, fibers, or Cordis internals.

## Core invariants

1. **Observer mode is behavior-neutral.** It registers observers but does not wrap target listeners, replace `next()`, reorder hooks, or mutate dispatched arguments.
2. **Unknown stays unknown.** Derived values are labeled as derived; unsupported values are absent/null rather than fabricated.
3. **Collection is bounded.** Timeline-like structures have fixed or configured retention.
4. **Metadata-first privacy.** Raw event arguments, prompts, tool results, file contents, and credentials are not collected by default.
5. **Lifecycle ownership is explicit.** Every observer/subscription is disposed with the owning plugin fiber.

## Instrumented mode boundary

Per-listener latency, `next()` tracking, short-circuit attribution, self time, downstream time, and input/output diffs require executing code around target listeners. Those features are not an incremental tweak to observer mode: they are a separate instrumented mode because instrumentation can perturb timing and semantics.

Before adding that mode, create or update an architecture Agent Note covering wrapping strategy, recursion/reentrancy, async error propagation, disposal, ordering preservation, overhead, privacy, and a way to prove the uninstrumented path is unchanged.

## Testing layers

Pure helpers use unit tests. Runtime ownership and hook behavior should use real `@deepseek-ai/cordis`. Once package installation/loading becomes part of supported behavior, add a built/packed-artifact smoke path. Once Web UI is supported, add browser-level verification rather than relying only on component self-reports.
