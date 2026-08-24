# Agent Note: DSH live controlled experiment tools

Status: implemented

## Problem

The v0.6 DSH start/stop adapter already enforced one-shot approval and exact-lease cleanup, but it was not registered by the plugin entry. A running DSH Agent therefore could not discover or execute the approved controlled-experiment tools against the live `DevtoolsService` coordinator.

## Decision

Plugin `apply()` installs `installDshExperimentTools(ctx, service)` after the Host service and read-only `CordisRuntime` provider are created.

The install stays optional through `ctx.inject(['tools'])`: pure Cordis use does not require DSH ToolRuntime, while a DSH Host with ToolRuntime receives exactly the dedicated start/stop pair.

The live service itself satisfies the adapter control contract, so there is no second DSH ownership state. Start still calls the real `ctx.approval` seam inside the tool body and only `allowed-once` reaches `service.startAgent('dsh', ...)`. Stop still delegates exact-lease cleanup without a second approval.

## Alternatives considered

### Add start/stop to `CordisRuntime`

Rejected. Inspect remains read-only and is already discoverable through DSH's model-facing inspect tools; mutation requires a dedicated approval-bearing tool path.

### Require ToolRuntime as a hard plugin dependency

Rejected. The package remains usable as a pure Cordis/Human DevTools plugin; DSH-native Agent tools are attached only when the DSH `tools` service exists.

### Maintain DSH-specific lease state

Rejected. The live `DevtoolsService`/coordinator is the sole instrumentation owner.

## Verification

Focused adapter tests preserve approval-first/fail-closed semantics and now also prove both tool registrations are lifecycle-owned and disposed in reverse order. The final combined real DSH E2E is responsible for exercising the actual DSH ToolRuntime + approval answerer seam with an open turn; this PR does not add a duplicate local copy of DSH core packages solely for a mock-equivalent unit test.
