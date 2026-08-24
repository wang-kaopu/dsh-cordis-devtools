# Agent Note: v0.4 repository release closeout

Status: implemented

## Problem

The v0.4 read-only Agent Runtime Diagnostics slice is already merged and verified, but the package manifest and primary README still identify the repository as v0.3.0 and describe the product primarily as the human DevTools/Profiler surface. That makes the repository-level release state inconsistent with the code that is actually on `main` and hides the DSH Cordis Inspect and external MCP paths from a new user.

Repository readiness and publication are intentionally separate in this project, so leaving the manifest at 0.3.0 is not required merely because no npm package or Git tag has been published.

## Decision

Close the repository-level v0.4 milestone by bumping the package manifest to `0.4.0` and updating the public README to describe the landed Agent Runtime Diagnostics product boundary.

The README records the shared Runtime Diagnostics Query layer, DSH `CordisRuntime` Inspect Provider, optional loopback-only embedded MCP endpoint, five read-only Agent queries/tools, bounded evidence semantics, combined real-DSH proof, and the v0.4 milestone. Package metadata also uses the runtime-diagnostics description and discoverability keywords appropriate to the landed product.

This closeout does not publish npm artifacts, create a Git tag/release, enable remote MCP access, or start the deferred profiler-mutation Wave F. Those remain separate actions/decisions.

## Alternatives considered

- Keep the repository manifest at `0.3.0` until an npm publish happens. Rejected because the repository already distinguishes repository readiness from publication, and the stale version would misdescribe the code on `main`.
- Publish npm and create a `v0.4.0` Git tag as part of the same closeout. Rejected because the maintainer approved repository work and automatic PR merging, not an external package publication or release/tag operation.
- Pull profiler mutation tools into v0.4 before calling the milestone complete. Rejected because the v0.4 roadmap explicitly defines Waves A–E as the first complete read-only slice and requires a separate decision for mutation permissions/lease semantics.
- Leave the README architecture centered only on the Web panel. Rejected because DSH Inspect and MCP are now first-class shipped consumers of the same runtime facts and should be visible at the primary product entry point.

## Consequences

After this change the repository version and primary documentation match the code that is already landed: v0.4 is a repository-ready Agent Runtime Diagnostics release with read-only DSH and external MCP access plus the existing human DevTools/Profiler UI.

No publication claim is introduced. npm/package registry state and Git tags/releases can still be performed independently. Wave F remains deferred, so v0.4 keeps a clear safety boundary: Agent diagnostics are read-only and profiler instrumentation remains controlled only through the existing explicit human DevTools action.
