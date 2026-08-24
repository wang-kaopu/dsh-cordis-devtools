# Agent Note: Unified waterfall control integration

Status: implemented

## Problem

The v0.6 shared contract, coordinator, trace attribution, DSH approval adapter, and MCP authority adapter were intentionally developed as separate pieces. Production `DevtoolsService` still owned a raw `WaterfallInstrumentationController`, and the existing browser Profiler RPC still reached the controller through boolean enable/disable semantics. Without one integration boundary, Human, DSH, and MCP adapters could eventually acquire parallel mutation paths and trace attribution would not be tied to the authoritative live owner.

## Decision

`DevtoolsService` now composes the low-level controller and exactly one `WaterfallExperimentCoordinator`. The coordinator is the only production owner allowed to mutate the controller.

The service integration establishes these rules:

- the existing Human browser enable path acquires Human ownership through the coordinator;
- the existing Human browser disable path is the local emergency-stop boundary and may terminate either a Human session or an Agent lease;
- Agent start/stop delegates to the same coordinator and never bypasses it;
- the controller resolves `experimentId` from the coordinator only when a new waterfall trace is created;
- `profilerSnapshot()` includes factual experiment ownership alongside the existing instrumentation state and bounded traces;
- `RuntimeDiagnosticsQuery.waterfallExperimentStatus()` exposes read-only ownership facts;
- `CordisRuntime` exposes that status as an inspect method and adds exact `experimentId` filtering to `profilerTraces` without adding any mutation method;
- service disposal delegates coordinator cleanup rather than directly disabling the controller.

`WaterfallProfilerSnapshot.experiment` is optional so older serialized/test snapshots remain readable while v0.6 Hosts include the field.

## Alternatives considered

### Keep Human boolean control as a raw-controller exception

Rejected. A second production mutation path would make the coordinator advisory rather than authoritative and could silently overwrite Agent ownership.

### Route Human disable only through `stopHuman()`

Rejected. The approved v0.6 safety model requires the visible Human surface to emergency-stop an Agent lease. Existing browser disable therefore maps to coordinator `forceStop()`.

### Expose Agent start/stop through `CordisRuntime`

Rejected. `CordisRuntime` remains a read-only inspection/verification provider. DSH mutation uses dedicated approved tools and external mutation uses authenticated MCP capability in later live-wiring waves.

### Pass the coordinator to DSH/MCP from `src/index.ts` in this integration PR

Rejected for Wave G. Keeping live adapter wiring out of this sequential gate preserves the approved second fan-out: DSH, MCP, and Human UX can proceed independently from one stable Host control boundary.

## Consequences

Human traces remain untagged because Human ownership has no experiment id. Agent traces are tagged with the exact active lease id captured at trace creation, and late updates keep that captured id.

A Human enable request cannot steal an active Agent lease. A Human disable request can terminate it safely; a later Agent stop then observes `not-active` and cannot mutate a newer owner.

If controller cleanup detects a third-party dispatch replacement, conflict remains factual and DevTools does not overwrite the competing seam. Logical coordinator ownership is cleared rather than pretending DevTools still owns instrumentation.

The next implementation wave may wire the already-developed DSH and MCP adapters to this service and update the Human Profiler UI, but those adapters must share this coordinator state rather than add private ownership flags.
