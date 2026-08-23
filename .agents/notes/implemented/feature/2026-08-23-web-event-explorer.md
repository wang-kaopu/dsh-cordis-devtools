# Agent Note: Add the Web Event Explorer

Status: implemented

## Problem

The host had a trustworthy live Event / Listener Registry but no user-visible surface. The package's placeholder client entry was still built as ordinary ESM, so it was not a real DSH Web client bundle, and there was no owned Host-to-browser data path for the process-global registry.

The registry is Host runtime state rather than session state. It therefore should not be encoded into session projection, and an external plugin should not require a DeepSeek Harness core patch merely to expose its own read-only diagnostics.

## Decision

The Web Event Explorer uses a small Host/Client adapter around the existing shared snapshot contract.

The Host registers `/cordis-devtools` through DSH Connection and exposes a single read-only `snapshot` endpoint. The channel is `loopback` authority only. Registration is performed inside `ctx.inject(['connection'], ...)`, so pure Cordis use remains valid when Connection is absent and the real DSH `rpc.handle()` registration remains owned by the reading plugin fiber. The RPC adapter never reads Cordis internals; it only returns `CordisDevtoolsService.snapshot()`.

The package now declares a DSH Web client entry and builds two distinct artifacts: Node ESM + declarations for the Host, and a browser CJS bundle wrapped in `window.__ModuleLoader__.load(...)` for `./client`. React and its JSX runtime remain module-table externals rather than being bundled as duplicate runtime identities.

The browser entry consumes only the `connection` and `slots` Cordis services. It registers additively into `sidebar.footer.action` with id `cordis-devtools`; it does not replace Conversation, Settings, or the Sidebar shell.

The panel presents only existing `DevtoolsSnapshot` facts: event names/counts, listener order/id, owner fiber name/uid/state, and `prepend`/`global`. It provides event search and explicit refresh. Dispatch mode remains absent from the event view because mode belongs to concrete dispatch records rather than event registration.

The browser keeps presentation state plus the latest serializable snapshot. Opening the panel triggers an immediate read and starts a one-second polling loop; closing or disposing it aborts an in-flight request and stops polling. Requests never overlap. A failed refresh retains the previous snapshot but labels it stale and surfaces the error.

The implementation is protected at three boundaries: unit tests for RPC and polling semantics, a jsdom/React integration test for the visible explorer, and a post-build gate that executes `lib/client.js`, observes its DSH module-loader registration, invokes the registered factory with platform-module stubs, and verifies the resulting Cordis client plugin face.

## Alternatives considered

**Use session projection.** Rejected because the registry belongs to the Host Cordis process rather than one session, and the panel must work with no active conversation.

**Add a capability to DSH `api-remotes` or the legacy `/api` namespace.** Rejected because those are application-owned surfaces. DSH Connection already exposes an independent logical RPC channel seam suitable for an external plugin.

**Push every registry invalidation through a forwarded Host event, long-poll channel, or WebSocket.** Rejected for the first explorer because listener-registry changes are low frequency. Visible-only one-second polling is bounded and avoids inventing revision, reconnect, and watch semantics before the Dispatch Timeline needs them.

**Put the explorer in `conversation.view`.** Rejected because that slot is session presentation. `sidebar.footer.action` is root-scoped, additive, and already used by DSH's own Cordis tooling.

**Bundle DSH client packages or React into the browser artifact.** Rejected because runtime identity-bearing platform modules must be supplied by the DSH module table and service graph, not duplicated inside an external plugin bundle.

**Build UI semantics from browser-side Cordis internals.** Rejected because the Host/shared snapshot is the authoritative diagnostic contract. The client only joins listener ids already supplied by each `EventSnapshot` to their corresponding `ListenerSnapshot` records for presentation.

## Consequences

The project now has its first interactive DevTools surface and a real Web client packaging path. Future UI features can reuse the same Host/shared/client boundary instead of rediscovering how DSH bundles and transports external client plugins.

The Connection RPC shape and DSH module-loader wrapper are compatibility seams. Their implementation knowledge remains localized in `src/host/rpc.ts`, `src/client/port.ts`, `src/client/index.ts`, and `tsdown.config.ts`, with a built-artifact smoke gate to catch drift.

Polling creates one bounded request per second only while the panel is visible. If the future Dispatch Timeline needs lower latency or high-rate streaming, it should replace this refresh strategy through a separate architecture decision rather than silently increasing polling frequency.

The panel intentionally does not expose dispatch history, timing, payloads, plugin topology, mutation actions, persistent listener ids, or a static event mode. Those remain separate future features.
