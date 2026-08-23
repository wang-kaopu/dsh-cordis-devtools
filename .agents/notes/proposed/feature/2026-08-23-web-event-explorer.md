# Agent Note: Add the Web Event Explorer

Status: proposed

## Problem

The host now exposes a trustworthy live Event / Listener Registry through `CordisDevtoolsService.snapshot()`, but the project still has no user-visible surface. Developers must consume the service programmatically, so the first shipped feature cannot yet answer the basic interactive questions this project is meant to make cheap: which events currently exist, how many listeners they have, in what order those listeners run, and which fiber owns each registration.

The initial scaffold also does not yet produce a real DSH browser client bundle. `tsdown.config.ts` currently builds the Host entry and `src/client/index.ts` together as ESM with declarations. DSH's web client-module system instead discovers packages that declare `dsh.client`, serves their `exports["./client"]` artifact, and expects that artifact to register a browser module factory with `window.__ModuleLoader__`.

A second boundary is transport. The Event / Listener Registry is process-global runtime state, not session state, so session projection is the wrong data plane. DSH's `api-remotes` assembly is also a fixed application BFF whose mounted capabilities are selected in the Harness repository; an external plugin should not require a core DSH patch merely to expose its own diagnostics.

Current DSH Connection already exposes the intended extension seam: Host plugins can register an owned logical RPC channel with `ctx.connection.rpc.handle()`, and browser plugins can call that channel with `ctx.connection.rpc.call()`. Channel registrations are lifecycle-owned and can be restricted to loopback authority.

For placement, DSH exposes the additive root-scoped `sidebar.footer.action` list slot. It is explicitly intended for optional actions beside Settings, and DSH's own `ui-cordis` package uses that slot to mount a Cordis panel without replacing the conversation surface.

## Proposal

Ship v0.2 as a host-to-browser Event Explorer panel, while keeping the feature focused on the registry already implemented.

### 1. Add a loopback-only DevTools RPC channel

Add a Host adapter responsible only for exposing existing `CordisDevtoolsService` data over DSH Connection:

```text
/cordis-devtools
  └── snapshot
```

The Host plugin should inject/use the existing `connection` service and register the channel with:

```text
authority: 'loopback'
```

`snapshot` takes no meaningful payload and returns the current serializable `DevtoolsSnapshot` from the collector. Unknown endpoints return a structured RPC error rather than silently falling through.

The RPC layer must not read Cordis internals itself. Its source is the already-established `CordisDevtoolsService`; `_hooks` knowledge remains isolated in `src/host/cordis-adapter.ts`.

Keep the channel read-only in this feature. `clearDispatches()` is not exposed to the Web UI yet because the Event Explorer does not present dispatch history.

### 2. Turn the placeholder client output into a real DSH browser bundle

Split the build into distinct Host and Client faces.

Host output remains ESM + declarations for Node/Cordis consumption.

The Client output must be a browser-targeted bundle exported at `./client` and wrapped in the DSH module-loader factory form expected by the current web client module system. The package declares:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-sidebar"
    ]
  }
}
```

Exact module externals should follow the current DSH client-module contract: platform-provided runtime identities such as React, Cordis, slots, primitives, and requested client packages must remain external to the browser bundle rather than being duplicated inside it.

The browser entry exports a Cordis client plugin object (`module.exports`) with the services it actually consumes, expected initially to include `slots` and `connection`.

### 3. Use an additive sidebar footer panel

Register one entry in:

```text
sidebar.footer.action
```

with an id owned by this package, for example `cordis-devtools`.

The action renders a compact trigger in both expanded and rail sidebar modes. Activating it opens a fixed-position panel anchored near the trigger, following the same ownership pattern used by DSH's own Cordis panel: the sidebar owns geometry, while the contributed component owns panel state and business data.

Do not register into `conversation.view`: the DevTools registry is root/process state and should remain accessible even when there is no active session. Do not replace `sidebar.settings` or any single/occupied root slot.

### 4. Render Events first, listener detail second

The first panel should show only facts already present in `DevtoolsSnapshot`.

Primary event list:

- searchable event name;
- live listener count;
- selected state.

Selected event detail:

- listener execution order;
- runtime-local listener id;
- owner fiber name;
- owner fiber uid when present;
- owner fiber state;
- `prepend` flag;
- `global` flag.

A small header may show total live events/listeners and the snapshot generation time.

Do not display an event-level dispatch mode. Do not infer timings, call counts, or historical behavior from the registry.

### 5. Keep refresh semantics deliberately simple

The client fetches a snapshot immediately when the panel opens and offers an explicit Refresh action.

While the panel is open, it may poll `snapshot` at a low fixed cadence (target: 1 second) so plugin load/unload and listener registration changes become visible without user action. Polling stops when the panel closes or the client plugin is disposed.

This feature does not add a push protocol, long-poll endpoint, WebSocket stream, revision counter, or forwarded Host event. Registry changes are relatively low-frequency, and adding a transport protocol now would enlarge the feature beyond the UI it serves.

A later Dispatch Timeline feature may introduce a dedicated watch/push design if high-rate low-latency updates create a real requirement. That decision should not be preempted here.

If a refresh fails, the panel should show a visible connection/error state. It may retain the last successful snapshot but must distinguish stale data from a successful current refresh.

### 6. Keep client state presentation-only

The browser owns only UI state and the latest fetched serializable snapshot:

```text
open / closed
search query
selected event
loading / error
latest DevtoolsSnapshot
```

It must not reconstruct owner relationships, inspect browser-side Cordis internals, or maintain a second incremental registry model. Event/listener semantics remain defined by the Host/shared snapshot contract.

### 7. Verify the real boundaries introduced by this feature

Verification should cover at least:

- Host RPC adapter returns the collector's current snapshot and rejects unknown endpoints;
- the RPC channel is registered with loopback authority and lifecycle-owned by the plugin fiber;
- client polling starts only while the panel is open and stops on close/disposal;
- request failure is visible and does not masquerade stale data as fresh;
- event search and selection render the corresponding listener order and fiber metadata from a supplied snapshot;
- no event-level `mode` appears in the UI;
- client slot registration targets `sidebar.footer.action` additively;
- the built `./client` artifact uses the actual DSH browser module-loader entry path rather than source-only imports;
- `pnpm verify:policy`, type checking, tests, and both Host/Client builds pass.

A DOM/component integration test is required for the first visible panel. A full DSH browser screenshot/e2e harness may be added in a follow-up if establishing that harness would dominate this feature; the built client bundle path itself must still be smoke-tested now so the first UI cannot pass only through source-level tests.

## Alternatives considered

**Use session projection like `dsh-context`.** Rejected because the DevTools registry describes one Host Cordis runtime rather than one conversation/session. Encoding global runtime state into every session projection would give the data the wrong ownership and make the no-session UI unnecessarily difficult.

**Add the capability to DSH `api-remotes`.** Rejected because `api-remotes` is an application-selected BFF with explicit mounted capabilities. Requiring an upstream DeepSeek Harness change for an external plugin's private read-only diagnostics would couple plugin releases to the host repository and defeat the generic Connection RPC seam that already exists.

**Call legacy `/api` methods directly from the browser.** Rejected because the plugin does not own that method namespace, and DSH already provides a logical channel registry specifically so independent features do not collide inside the shared legacy API surface.

**Forward a Host Cordis event to push every registry invalidation.** Rejected for v0.2 because the standard forwarded-event allowlist is centrally selected by DSH and the registry does not require high-frequency real-time delivery. Low-rate polling while the panel is visible is simpler, externally deployable, and bounded.

**Implement a long-poll/watch protocol now.** Rejected until a higher-rate timeline feature demonstrates that 1-second visible-only polling is insufficient. A watch protocol would need revision/race semantics, reconnect behavior, and cancellation tests that do not improve the first Event Explorer's core value.

**Put the explorer in `conversation.view`.** Rejected because that slot is session-scoped presentation and only exists inside the conversation owner. Runtime DevTools should be reachable with no current session and should not become another conversation tab.

**Replace the Settings slot or entire sidebar/conversation surface.** Rejected because those are occupied/single surfaces and replacing them would shadow shipped UI. `sidebar.footer.action` is explicitly additive and is already used for Cordis-related tooling.

**Bundle React/Cordis/client services into the plugin's browser artifact.** Rejected because those are runtime identity-bearing platform modules. Duplicating them risks incompatible Cordis contexts/React identities and violates the current client module graph model; the browser bundle should request/externalize the host-provided identities instead.

## Acceptance criteria

- The package declares a valid DSH Web client entry and `./client` built artifact.
- Host and Client are built with separate target/format rules appropriate to Node and the DSH browser module loader.
- Host registers a lifecycle-owned, loopback-only `/cordis-devtools` RPC channel with a read-only `snapshot` endpoint.
- Client retrieves `DevtoolsSnapshot` only through the DSH Connection RPC service; no direct Host/internal access exists in client code.
- A `sidebar.footer.action` entry opens the Event Explorer without replacing shipped Conversation, Settings, or Sidebar surfaces.
- The panel works without an active session.
- The panel lists live events and lets the user inspect listener order, id, owner fiber name/uid/state, `prepend`, and `global`.
- Event search is available.
- Opening the panel refreshes immediately; visible-only polling keeps it reasonably current; closing/unloading stops polling.
- Failed refreshes are visibly distinguished from successful current data.
- No static event mode, timing, payload, dispatch timeline, plugin topology, or mutation action is added.
- The client has a DOM-level integration test and the built DSH client artifact is smoke-tested through its actual module-loader entry shape.
- Repository policy, typecheck, tests, Host build, and Client build pass.

## Risks

- `@deepseek-ai/dsh-client-connection` and the client module-loader contract are DSH-facing integration dependencies. Their package versions and browser bundle conventions can change across RC releases; keep Connection transport code and client-build glue localized instead of spreading host-specific imports across UI components.
- The current repository build config was intentionally minimal and will become more complex when Host and browser faces split. Keep that complexity in `tsdown.config.ts`; UI/business modules should not know how the loader wrapper is produced.
- One-second polling trades protocol simplicity for bounded repeated requests. It must only run while the panel is visible and must never create overlapping refresh loops. If later timeline work needs faster updates, replace the refresh strategy through a new decision rather than silently decreasing the interval.
- A root-scoped diagnostics panel can expose plugin/fiber names and runtime topology information. The RPC channel is therefore loopback-only even though the current snapshot intentionally excludes raw event arguments, prompts, tool results, file contents, and secrets.
- The sidebar slot is a DSH Web UI contract. If DSH later removes or renames the additive footer-action slot, the client adapter must move to another documented additive root slot without changing the Host/shared registry semantics.
