# Agent Note: Add a real DSH Web integration lane

Status: implemented

## Problem

Existing tests prove Cordis behavior, React/jsdom rendering, RPC contracts, and built client module registration, but they do not prove that the public DSH Web application can install this checkout as an external plugin and render its sidebar surface in a real browser.

## Decision

Add a separate browser integration job using an isolated temporary DSH home, the published DSH CLI version matching the current DSH UI dependencies, and Playwright Chromium. The scenario installs this checkout into a disposable Web profile, boots the real Web application on loopback, opens Cordis DevTools, verifies a runtime snapshot is visible, switches through Events, Timeline, and Fibers, then closes the panel.

The scenario makes no model call. It validates composition and external-plugin loading rather than duplicating detailed component assertions.

## Alternatives considered

- Copy DeepSeek Harness's internal Web test scaffold. Rejected because it is monorepo-internal and would couple this external plugin to private workspace paths.
- Rely only on the existing built-client smoke. Rejected because it cannot prove profile installation, HTTP composition, or browser layout loading.
- Put browser setup into the normal check job. Rejected because Chromium and DSH boot are heavier integration concerns that can run independently in parallel.

## Consequences

Pull requests gain a real-browser signal for the public installation path. The separate lane has additional network and browser setup cost, while the existing policy, typecheck, unit, build, and client-bundle checks remain unchanged and can run concurrently.
