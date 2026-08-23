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
    ├────────────────────────► future CLI/export
    │
    ▼
src/host/rpc.ts
    │  loopback-only DSH Connection adapter
    ▼
/cordis-devtools/snapshot
    │
    ▼
src/client/port.ts
    │  validates the serializable snapshot boundary
    ▼
src/client/store.ts
    │  visible-only refresh state
    ▼
src/client/EventExplorer.tsx
       additive sidebar Web presentation
```

### Host adapter

`cordis-adapter.ts` is the only normal location for direct dependence on unstable Cordis implementation details such as listener registry storage. When Cordis changes an internal field, repair the adapter and keep downstream types stable where possible.

### Collector

The collector listens to authoritative Cordis lifecycle and dispatch signals and owns bounded in-memory history. It does not interpret an event start signal as an event completion signal and does not claim timing data Cordis did not expose.

### Shared model

`src/shared` describes facts the collector can support. A shared field is an observability contract: adding a field requires a reliable source, clear unknown/null semantics, and a decision about whether it is safe to expose to clients.

Event registration and dispatch remain separate concepts. `EventSnapshot` represents the current live listener registry; invocation mode remains on concrete `DispatchRecord` entries because Cordis chooses `emit`, `parallel`, `serial`, `bail`, or `waterfall` per call.

### Host-to-client transport

The Web client does not read Host services or Cordis internals directly. `src/host/rpc.ts` projects the existing `CordisDevtoolsService.snapshot()` through DSH Connection at `/cordis-devtools/snapshot` with `loopback` authority. This adapter is read-only and contains no registry logic.

The channel is installed through `ctx.inject(['connection'], ...)`, so Connection is optional for pure Cordis/Host use. DSH Connection owns the physical HTTP transport and lifecycle of the registered logical channel.

### Client

The package emits a real DSH browser module at `./client`, separate from the Node Host artifact. The browser bundle registers through `window.__ModuleLoader__`, requests the runtime services through Cordis, and keeps React as a platform-provided module identity.

`src/client/port.ts` is the transport compatibility seam. `src/client/store.ts` owns only refresh/loading/stale state. The React layer renders the shared snapshot and contributes additively to `sidebar.footer.action`; it does not maintain a second listener registry or infer Host facts.

The first refresh strategy is intentionally simple: fetch immediately when the panel opens, poll once per second only while visible, abort/stop on close, and never overlap requests. A future high-rate Dispatch Timeline may replace this through a separate decision.

## Core invariants

1. **Observer mode is behavior-neutral.** It registers observers but does not wrap target listeners, replace `next()`, reorder hooks, or mutate dispatched arguments.
2. **Unknown stays unknown.** Derived values are labeled as derived; unsupported values are absent/null rather than fabricated.
3. **Collection is bounded.** Timeline-like structures have fixed or configured retention.
4. **Metadata-first privacy.** Raw event arguments, prompts, tool results, file contents, and credentials are not collected by default.
5. **Lifecycle ownership is explicit.** Every observer/subscription/channel/timer is disposed with the owning plugin or UI lifecycle.
6. **Transport does not become a second source of truth.** Host RPC returns the collector snapshot; Client code does not recreate Cordis semantics.

## Instrumented mode boundary

Per-listener latency, `next()` tracking, short-circuit attribution, self time, downstream time, and input/output diffs require executing code around target listeners. Those features are not an incremental tweak to observer mode: they are a separate instrumented mode because instrumentation can perturb timing and semantics.

Before adding that mode, create or update an architecture Agent Note covering wrapping strategy, recursion/reentrancy, async error propagation, disposal, ordering preservation, overhead, privacy, and a way to prove the uninstrumented path is unchanged.

## Testing layers

Pure helpers use unit tests. Runtime ownership and hook behavior use real `@deepseek-ai/cordis`. Host-to-client adapters get contract tests at the Connection seam. Visible UI gets jsdom/React integration coverage. The built browser artifact is executed by `verify:client-bundle` to prove the actual `window.__ModuleLoader__` handoff works rather than relying only on source-level tests.

A full DSH browser/profile smoke path should be added when the next Web feature makes maintaining that harness cheaper than repeatedly reasoning about the installed composition by hand.
