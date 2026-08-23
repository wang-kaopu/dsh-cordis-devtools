# Agent Note: Add the Dispatch Timeline

Status: implemented

## Problem

The Web Event Explorer exposed the live Event / Listener Registry, while the Host already retained a bounded sequence of `DispatchRecord` values that users could not inspect. At the same time, the first Web surface hand-built too much control chrome with native buttons, a native search input, local chips, and a large inline style map. Extending that pattern for Timeline filtering would have increased visual and interaction drift from DeepSeek Harness.

The feature therefore needed to make the existing dispatch observations visible without claiming completion semantics the observer does not possess, while establishing a durable boundary between DSH-provided UI atoms and DevTools-specific layout.

## Decision

The single `sidebar.footer.action` contribution now opens one Cordis DevTools shell with `Events` and `Timeline` views. Switching views is presentation state only and reuses the existing `EventExplorerStore`, so opening the shell still owns exactly one visible-only polling loop and one latest `DevtoolsSnapshot`.

Matching controls now use `@deepseek-ai/dsh-client-ui-primitives`: `Button`, `Input`, `Pill`, `Tooltip`, `DisclosureRow`, `useDismissOnOutsidePointer`, and DSH icon exports. The package keeps DevTools-specific panel, event-grid, list, and detail geometry in `DevtoolsPanel.module.css` using `--dsw-*` tokens. Reuse follows semantic fit rather than trying to replace every surface-specific element with a generic atom.

`@deepseek-ai/dsh-client-ui-primitives` is a development/type-time dependency pinned to the DSH client family used for verification (`0.1.1-rc.2`). It is externalized from `lib/client.js` because DSH Web already exposes it as a platform module. It is intentionally not added to `dsh.client.inject`, which describes client plugin/service dependencies rather than shell platform modules. `verify:client-bundle` now proves that the built module-loader factory actually requests and resolves this external.

The package-owned CSS Module is compiled with a small `lightningcss` plugin in `tsdown.config.ts` and injected when the client module-loader factory executes. This mirrors the relevant DSH dynamic-client packaging behavior and avoids emitting a detached stylesheet that the external plugin loader would not load automatically. Because the build config now imports Node built-ins, the repository typecheck explicitly includes Node types.

Vitest keeps the real DSH primitive implementations in component tests. `@deepseek-ai/dsh-client-ui-primitives` is inlined through Vitest 4 `test.server.deps.inline` so Vite handles the package's CSS Modules instead of asking native Node to import `.css`. The tests do not replace the primitives with local UI mocks.

The Timeline renders the current bounded `snapshot.dispatches` window newest-first. It supports free-text search over event name and known dispatch-context fiber name, plus mode filters derived from modes present in the current snapshot. Collapsed rows show event name, invocation mode, timestamp, and registered-listener count. Expanded details show runtime-local dispatch id, argument count, registered-listener count, and the dispatch context fiber when Cordis exposed one.

The UI explicitly describes the data as recent bounded dispatches rather than a complete or lossless audit log. It does not display duration, completion/outcome, thrown-error attribution, executed-listener identity, per-listener timing, `next()` or short-circuit attribution, or raw event arguments. `internal/dispatch` remains a pre-execution observation signal, so those facts are unsupported in observer mode.

The existing loopback-only snapshot RPC and one-second visible-only polling remain unchanged. No push/watch protocol, mutation endpoint, persistence, payload capture, or additional browser-side dispatch database is introduced.

## Alternatives considered

**Add Timeline without refactoring the Event Explorer chrome.** Rejected because it would duplicate more local buttons, filters, badges, and interaction styling on a surface already diverging from DSH shared atoms.

**Replace the complete floating panel with DSH primitives.** Rejected because the primitives are reusable atoms, not a universal DevTools container. DSH's own client surfaces also keep business-specific layout in package-owned CSS while reusing shared controls and icons.

**Bundle `@deepseek-ai/dsh-client-ui-primitives` into the plugin.** Rejected because DSH Web provides it as a platform module. Bundling another copy would increase drift and defeat the shared runtime/style identity.

**Mock DSH primitives in component tests.** Rejected because that would make the tests prove only the plugin's local assumptions. Vitest dependency inlining allows the real npm primitive implementations and their CSS Modules to run through Vite instead.

**Create a second sidebar action or a second Timeline store.** Rejected because Events and Timeline share one diagnostics service, one snapshot contract, and one lifecycle; duplicating navigation or polling state would fragment that model.

**Stream dispatches immediately with WebSocket, long-poll, or a forwarded Host event.** Rejected until actual use demonstrates that bounded one-second snapshots are materially insufficient. A stream needs explicit revision, reconnect, gap, cancellation, backpressure, and delivery semantics.

**Expose `clearDispatches()` from the Web panel.** Rejected because the current Web channel is deliberately read-only and clearing Host observation state is a mutation feature with a separate contract.

**Derive duration or outcome from adjacent records or browser receive time.** Rejected because those values would be fabricated from a pre-execution signal.

## Consequences

Cordis DevTools now has a consistent Web shell whose controls inherit DSH behavior and visual tokens, while surface-specific information architecture remains owned by this package. Future views should reuse the same rule: prefer DSH atoms when their semantics match, then keep only domain-specific composition locally.

The Timeline is useful for recent runtime activity but remains intentionally lossy at sufficiently high dispatch rates: the Host ring buffer is bounded and polling is periodic. If real use requires loss detection or lower latency, a separate transport architecture decision is required rather than silently increasing polling frequency or pretending the current view is an audit stream.

The DSH primitives package, its platform-module identity, the CSS-module injection seam, and Vitest dependency inlining are client compatibility boundaries. CI covers source-level behavior, the real primitive package under Vite, Host/Client builds, and execution of the built module-loader factory. A full installed DSH Web profile/browser E2E harness remains deferred.
