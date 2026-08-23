# Agent Note: Add the Dispatch Timeline

Status: proposed

## Problem

The Web Event Explorer now proves the Host-to-browser diagnostics path, but the Web UI exposes only the live Event / Listener Registry. `ObserverCollector` already retains a bounded sequence of `DispatchRecord` values with runtime-local id, timestamp, invocation mode, event name, argument count, registered-listener count, and the dispatching fiber when Cordis exposes it. That data is currently invisible to users.

The first Web panel also established too much presentation chrome locally. `EventExplorer.tsx` hand-builds buttons, the search input, flag chips, panel positioning, and most interaction styling through inline style objects. The colors use `--dsw-*` tokens, but the component does not consume DSH's shared UI primitives. Extending this pattern for Timeline filters and expandable rows would duplicate more controls and make the plugin visually drift from the host application.

Current DSH Web already exposes `@deepseek-ai/dsh-client-ui-primitives` as a shared platform module alongside React/Cordis. It provides token-styled `Button`, `Input`, `Pill`, `Tooltip`, `DisclosureRow`, anchored/dismiss hooks, and the `ic_ds_*` icon set. DSH's own `ui-cordis` extension imports those primitives while keeping slot-specific layout in a package-owned CSS Module. That is the integration pattern this project should follow.

The transport decision also needs to stay explicit. Dispatch records can arrive much more frequently than listener-registry changes, but the existing snapshot is already bounded (500 records by default), ordered oldest-to-newest, and fetched once per second only while the panel is visible. The first Timeline should not invent a push/watch protocol unless the current bounded snapshot model proves insufficient.

## Proposal

Ship the first Dispatch Timeline inside the existing Cordis DevTools sidebar surface, while refactoring the shared panel chrome to use DSH primitives before adding more controls.

### 1. Make DSH primitives the default Web UI dependency

Add `@deepseek-ai/dsh-client-ui-primitives` as a development/type-time dependency following DSH's own client extension pattern.

Do **not** bundle the package into `lib/client.js`. The DSH Web shell already exposes it as a platform module, so the client build must externalize:

```text
@deepseek-ai/dsh-client-ui-primitives
```

alongside React identities. `verify:client-bundle` must provide a stub for that module so the built-artifact gate continues to execute the real module-loader factory path.

Do not add UI primitives to `dsh.client.inject`: that manifest list expresses client-plugin/service dependencies, whereas `ui-primitives` is a shell-provided platform module rather than a Cordis service.

### 2. Refactor the existing panel before adding Timeline chrome

Replace local equivalents when a DSH primitive matches the semantics:

- search field -> `Input`;
- refresh/toolbar actions -> `Button` and `Tooltip` where appropriate;
- view switcher and compact mode/filter badges -> `Pill`;
- dismiss behavior -> `useDismissOnOutsidePointer`;
- icons -> exported `ic_ds_*` glyphs rather than text glyphs or new local SVGs;
- expandable compact rows -> `DisclosureRow` when its row semantics fit.

Keep package-owned layout where it is genuinely surface-specific. The sidebar-trigger geometry, DevTools panel grid, timeline list virtualization/scrolling, and detail layout may remain a CSS Module composed from `--dsw-*` tokens. Do not force a generic primitive into a shape that DSH itself implements as consumer-owned slot layout.

Move the current large inline style map into one or more CSS Modules. The goal is not a visual redesign; it is to inherit DSH token behavior, hover/focus states, radii, control sizing, and dark/light theme behavior from shared atoms wherever possible.

### 3. Turn the Event-only panel into a small DevTools shell

Keep one `sidebar.footer.action` contribution and one floating panel. Inside it, add a DSH-style view switcher:

```text
Events | Timeline
```

The selected view is client-only presentation state. Opening/closing the shell continues to control the existing snapshot store, so there is still exactly one polling loop and one latest `DevtoolsSnapshot`.

Do not register a second sidebar action for Timeline. Event Registry and Dispatch Timeline are two views over the same Cordis diagnostics service and should share the same shell, refresh/error state, and lifecycle.

### 4. Render only facts already present in `DispatchRecord`

The Timeline view shows the recent bounded records from `snapshot.dispatches`, newest first in presentation order.

Collapsed row facts:

- event name;
- dispatch `mode`;
- timestamp;
- registered-listener count.

Expanded detail may show:

- runtime-local dispatch id;
- argument count;
- dispatching fiber name / uid / state when present;
- the same invocation mode and event name for context.

Do **not** display:

- duration;
- start/end timestamps;
- success/failure outcome;
- thrown error attribution;
- per-listener timing;
- which listeners actually executed;
- `next()` / waterfall short-circuit attribution;
- raw event arguments.

`internal/dispatch` is a pre-execution diagnostic signal, so none of those completion/execution facts are supported by the current observer.

### 5. Add lightweight presentation filters only

The first Timeline supports:

- free-text search over event name and known dispatching-fiber name;
- mode filters derived from modes actually present in the current snapshot;
- newest-first display.

Use DSH `Input` for text search and `Pill` for mode filters/view switching.

Filtering is browser presentation state only. It must not mutate or duplicate the Host ring buffer.

Do not add persisted filters, regex syntax, duration ranges, grouping, flame charts, or aggregation dashboards in this feature.

### 6. Keep the current snapshot transport for this milestone

Continue using the existing loopback-only `/cordis-devtools/snapshot` RPC and visible-only one-second polling.

The Timeline must describe itself as a **recent bounded timeline**, not a complete audit log. The Host ring buffer can overwrite old records, and a sufficiently high dispatch rate can advance the window between browser polls. The UI must not claim completeness or exactly-once delivery.

Do not add push, long-poll, WebSocket, revision cursors, or incremental delta endpoints in this feature.

If real usage shows one-second latency or ring-window overrun makes the Timeline materially hard to use, create a separate architecture decision for a watch/stream protocol with explicit reconnect, gap, cancellation, and backpressure semantics.

### 7. Preserve one source of truth and one lifecycle

The client continues to store only:

```text
panel open/closed
selected view
search/filter state
expanded row state
loading/error/stale
latest DevtoolsSnapshot
```

Do not build a second incremental dispatch database in the browser. Render from the latest Host snapshot and use `DispatchRecord.id` only as a runtime-local row identity.

Closing or disposing the panel keeps the existing behavior: stop polling and abort an in-flight request.

### 8. Verification

Add/extend tests that prove:

- the client bundle externalizes and resolves `@deepseek-ai/dsh-client-ui-primitives` through the DSH module-loader table;
- the shell still registers only one additive `sidebar.footer.action` contribution;
- Event and Timeline views switch without starting a second poller;
- Timeline presents records newest-first;
- event/fiber search and mode filters work;
- a row renders only supported observer facts;
- a snapshot containing a `waterfall` dispatch does not imply duration, outcome, executed listeners, or short-circuit information;
- existing Event Explorer behavior still works after the primitives refactor;
- stale/error behavior remains visible;
- repository policy, typecheck, tests, Host/Client build, and built client bundle smoke all pass.

A full browser/profile e2e remains desirable but is not required to land this feature unless the primitives integration cannot be credibly verified at the built module-loader boundary plus jsdom/component level.

## Alternatives considered

**Add Timeline without refactoring the existing Event Explorer chrome.** Rejected because it would duplicate more hand-built buttons, filters, badges, and positioning on top of a UI surface that already diverges from DSH's shared atoms. The second visible feature is the right point to establish the design-system boundary before drift compounds.

**Replace every element with a DSH primitive, including the entire floating-panel shell.** Rejected because DSH primitives are atoms, not a universal sidebar DevTools container. DSH's own `ui-cordis` keeps its panel/row geometry in consumer-owned CSS while importing shared icons/hooks/atoms. Reuse should follow semantics, not become cargo-cult composition.

**Create a separate sidebar action for Dispatch Timeline.** Rejected because Events and Timeline share one diagnostics service, one snapshot, and one lifecycle. Two footer actions would fragment navigation and duplicate polling/error state.

**Stream dispatches immediately over WebSocket or a forwarded Host event.** Rejected until the existing bounded one-second snapshot model demonstrates an actual usability failure. Streaming requires reconnect/gap/backpressure semantics and creates a second transport contract before the first Timeline exists.

**Expose `clearDispatches()` through the Web UI.** Rejected for this feature. Clearing Host observation state is a mutation action, while the current Web channel is intentionally read-only. Add mutation semantics separately if users demonstrate a real need.

**Compute duration/outcome from adjacent records or browser receive time.** Rejected because those values would be fabricated. `internal/dispatch` gives a pre-execution occurrence, not a generic completion signal.

**Bundle `@deepseek-ai/dsh-client-ui-primitives` into this plugin.** Rejected because DSH exposes it as a platform module. Duplicating it would undermine shared styling/runtime identity and increase bundle drift.

## Acceptance criteria

- The Web client imports and uses DSH UI primitives for matching controls rather than duplicating their local equivalents.
- `@deepseek-ai/dsh-client-ui-primitives` remains an external DSH platform module in the built client artifact.
- Existing Event Explorer behavior is preserved while its shared controls/chrome are aligned with DSH atoms and CSS tokens.
- The single Cordis DevTools panel contains `Events` and `Timeline` views.
- Timeline lists the current bounded `DispatchRecord` window newest-first.
- Timeline supports event/fiber text search and mode filtering.
- Timeline rows expose only timestamp, mode, event, registered-listener count, dispatch id, arg count, and known `thisFiber` metadata.
- The UI does not claim duration, outcome, executed-listener identity, short-circuit status, or completeness of history.
- Snapshot polling remains one loop, visible-only, with the existing stale/error semantics.
- No new Host transport, mutation endpoint, payload capture, instrumentation, or persistence is introduced.
- jsdom/component tests cover view switching, filters, timeline details, and the existing Event view after the primitive migration.
- `verify:client-bundle` exercises the DSH primitives external through the actual built module-loader factory.
- `pnpm verify:policy`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify:client-bundle` pass.

## Risks

- DSH UI primitives are moving with the RC client surface. Keep imports concentrated in the Web presentation layer and pin development compatibility to the DSH version family the plugin targets.
- Migrating from inline styles to CSS Modules can accidentally change geometry or accessibility even when the intent is visual alignment. Preserve existing data-testid/accessibility contracts where useful and cover view/search/open-close behavior at the DOM level.
- One-second snapshot polling is not a lossless event stream. The first Timeline is explicitly a bounded recent view; high-rate completeness must not be inferred from it.
- `DispatchRecord.thisFiber` is the dispatch context Cordis exposed at the pre-execution signal, not necessarily the owner of every listener that later runs. UI copy must preserve that distinction.
- A generic design-system rule can become overzealous. Prefer a DSH atom when its semantics fit, but retain consumer-owned layout when the host itself uses that pattern.