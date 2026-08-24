# Agent Note: Real DSH CordisRuntime Inspect E2E

Status: implemented

## Problem

The `CordisRuntime` adapter can be unit-tested through its narrow structural registry seam, but that alone does not prove compatibility with the first-party DSH `CordisInspectRegistryService`, its provider manifest validation, or the real Web profile composition lifecycle.

## Decision

Extend the real DSH Web smoke with an E2E-only local fixture that installs `@deepseek-ai/dsh-cordis-host-runner@0.1.1-rc.2`, contributes one live probe listener, waits for the real Host registry to discover `CordisRuntime`, and executes `CordisRuntime.inspectEvent` through `ctx.cordisInspect.query()`.

The fixture emits a deterministic Host log marker only after the query reports the probe event with at least one listener whose owner is currently live. The smoke waits for that marker before continuing the existing browser assertions.

The fixture remains under `e2e/fixtures` and is not part of the package `files` list, so it does not add the DSH Host Runner dependency to the production plugin package.

## Alternatives considered

- Rely only on the structural unit mock. Rejected because it cannot validate DSH's real manifest/schema registry behavior.
- Add DSH Host Runner as a production or top-level dev dependency. Rejected because the dependency is needed only inside the disposable E2E profile and should not change the normal package graph.
- Invoke an actual LLM through `cordis_inspect_query`. Rejected because that would require credentials and make the E2E nondeterministic; querying the same registry/service path directly proves the integration boundary without a model call.

## Consequences

The Web E2E takes slightly longer because it installs one additional local fixture and Host Runner package, but it now proves that the Provider is discoverable and executable through the actual DSH Cordis Inspect runtime while preserving the existing UI/profiler smoke coverage.
