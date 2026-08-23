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
    │  one visible-only latest-snapshot refresh state
    ▼
src/client/EventExplorer.tsx
    │  single additive sidebar DevTools shell
    ├─ Events view
    ├─ Timeline view
    └─ Fibers view
         │
         ▼
DSH UI primitives + package-owned CSS layout
```

### Host adapter

`cordis-adapter.ts` is the only normal location for direct dependence on unstable Cordis implementation details such as listener registry storage. When Cordis changes an internal field, repair the adapter and keep downstream types stable where possible.

The adapter also owns normalization of compact fiber references and live fiber inventory. Known numeric Cordis lifecycle states are converted to readable labels at this boundary, so downstream code never needs to know the enum's numeric representation.

For live plugin inventory, the adapter uses Cordis' public registry path: `ctx.registry.values()` and each runtime's live `fibers`. `DevtoolsSnapshot.fibers` therefore means current live registry membership rather than a history of fibers the observer happened to encounter.

### Collector

The collector listens to authoritative Cordis lifecycle and dispatch signals and owns bounded in-memory dispatch history. It does not maintain a second historical fiber registry. Live fiber data is snapped from the adapter on demand.

`DispatchRecord` captures a pre-execution occurrence: runtime-local id, timestamp, invocation mode, event name, argument count, registered-listener count, and dispatch context when available. It does not prove duration, completion outcome, which listeners ultimately executed, or waterfall short-circuit behavior.

`internal/plugin` invalidation is deferred/coalesced because Cordis clears a disposing fiber uid before removing that fiber from the runtime list. The adapter additionally excludes null-uid fibers from live inventory. Listener invalidation remains deferred because `internal/listener` fires before the hook enters `_hooks`.

### Shared model

`src/shared` describes facts the collector can support. A shared field is an observability contract: adding a field requires a reliable source, clear unknown/null semantics, and a decision about whether it is safe to expose to clients.

Event registration and dispatch remain separate concepts. `EventSnapshot` represents the current live listener registry; invocation mode remains on concrete `DispatchRecord` entries because Cordis chooses `emit`, `parallel`, `serial`, `bail`, or `waterfall` per call.

`FiberSnapshot` is a compact reference used by listener ownership and historical dispatch context. `LiveFiberSnapshot` is a stronger live-registry record with a non-null uid plus parent and inject-name metadata. Historical dispatch references can outlive a fiber that no longer exists in `DevtoolsSnapshot.fibers`; that difference is deliberate.

### Host-to-client transport

The Web client does not read Host services or Cordis internals directly. `src/host/rpc.ts` projects the existing `CordisDevtoolsService.snapshot()` through DSH Connection at `/cordis-devtools/snapshot` with `loopback` authority. This adapter is read-only and contains no registry or Timeline logic.

The channel is installed through `ctx.inject(['connection'], ...)`, so Connection is optional for pure Cordis/Host use. DSH Connection owns the physical HTTP transport and lifecycle of the registered logical channel.

### Client state

The package emits a real DSH browser module at `./client`, separate from the Node Host artifact. The browser bundle registers through `window.__ModuleLoader__`, requests the runtime services through Cordis, and keeps React plus DSH UI primitives as platform-provided module identities.

`src/client/port.ts` is the transport compatibility seam. `src/client/store.ts` owns only the latest snapshot plus refresh/loading/stale state. The React surface renders that snapshot and contributes once to `sidebar.footer.action`; it does not maintain a second listener registry, fiber registry, or incremental dispatch database.

Opening the panel fetches immediately and starts one one-second polling loop. Events/Timeline/Fibers view switching is local presentation state and does not change the refresh lifecycle. Periodic refresh is silent; closing/disposal aborts an in-flight request, stops the timer, and requests never overlap.

Because the Host ring buffer is bounded and refresh is periodic, the Timeline is explicitly a recent window rather than a lossless audit stream. The Fibers view may derive a **recent dispatch-context hit count** from that bounded window, but it must not present the value as a lifetime execution count. A future watch/stream transport requires a separate decision covering revisions, gaps, reconnect, cancellation, delivery, and backpressure.

### Web UI boundary

Controls reuse `@deepseek-ai/dsh-client-ui-primitives` whenever the semantics match: buttons, search inputs, pills, tooltips, disclosure rows, outside-dismiss behavior, and shared icons. This lets focus/hover/control sizing and theme tokens follow DSH rather than a local imitation.

DevTools-specific composition remains package-owned. `DevtoolsPanel.module.css` defines floating-panel geometry, Events/Fibers grids, Timeline list/detail layout, and responsive behavior using `--dsw-*` tokens. The rule is **DSH atoms for shared interaction semantics, local CSS for DevTools information architecture**.

Visual hierarchy prefers layer backgrounds, spacing, active state, and DSH primitives. Separators and high-contrast borders are not default structure; add them only where they are necessary for comprehension.

`@deepseek-ai/dsh-client-ui-primitives` is externalized from the browser artifact because DSH Web exposes it in the shared platform module table. The package's own CSS Module is compiled with `lightningcss` and injected by the dynamic client factory, so the external plugin does not depend on a separate stylesheet-loading path.

## Core invariants

1. **Observer mode is behavior-neutral.** It registers observers but does not wrap target listeners, replace `next()`, reorder hooks, or mutate dispatched arguments.
2. **Unknown stays unknown.** Derived values are labeled as derived; unsupported values are absent/null rather than fabricated.
3. **Collection is bounded.** Timeline-like structures have fixed or configured retention, and bounded views do not claim audit-log completeness.
4. **Metadata-first privacy.** Raw event arguments, prompts, tool results, plugin config, file contents, and credentials are not collected by default.
5. **Lifecycle ownership is explicit.** Every observer/subscription/channel/timer is disposed with the owning plugin or UI lifecycle.
6. **Transport does not become a second source of truth.** Host RPC returns the collector snapshot; Client code does not recreate Cordis semantics.
7. **UI reuse follows semantics.** Prefer DSH primitives for shared controls and behavior; keep only domain-specific composition local.
8. **Live inventory stays live.** `DevtoolsSnapshot.fibers` reflects Cordis registry membership; historical dispatch references do not get promoted into the live list.

## Instrumented mode boundary

Per-listener latency, `next()` tracking, short-circuit attribution, self time, downstream time, input/output diffs, and generic completion outcomes require executing code around target listeners. Those features are not an incremental tweak to observer mode: they are a separate instrumented mode because instrumentation can perturb timing and semantics.

Before adding that mode, create or update an architecture Agent Note covering wrapping strategy, recursion/reentrancy, async error propagation, disposal, ordering preservation, overhead, privacy, and a way to prove the uninstrumented path is unchanged.

## Testing layers

Pure helpers use unit tests. Runtime ownership, hook behavior, and live registry semantics use real `@deepseek-ai/cordis`. Host-to-client adapters get contract tests at the Connection seam. Visible UI gets jsdom/React integration coverage using the real DSH UI primitives through Vitest's Vite transform. The built browser artifact is executed by `verify:client-bundle` to prove the actual `window.__ModuleLoader__` handoff and platform primitive request work rather than relying only on source-level tests.

A full DSH browser/profile smoke path should be added when maintaining that harness becomes cheaper than repeatedly reasoning about installed composition by hand, or when a UI behavior depends on real browser layout beyond the current component/build boundaries.
