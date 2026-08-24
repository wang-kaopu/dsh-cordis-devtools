# Agent Note: v0.6 repository closeout

Status: implemented

## Problem

Controlled Runtime Experiments had landed across the shared contract, coordinator, trace attribution, DSH approval tools, MCP authority, unified service control, Human ownership UX, and the combined real DSH proof, while repository-facing metadata still identified the checkout as `0.5.0` and active v0.6 docs/architecture notes still described the work as planned.

A repository closeout must make source, product docs, Agent Note lifecycle, and protocol metadata self-consistent without implying an external release action that has not occurred.

## Decision

Close v0.6 at repository version `0.6.0` only after the full controlled-experiment implementation and real DSH proof are present on `main`.

The closeout:

- sets `package.json` repository version and product description to `0.6.0` Controlled Runtime Experiments;
- aligns the embedded MCP protocol server's reported version to `0.6.0`;
- updates README/product/roadmap/parallel records to the implemented single-coordinator authority model;
- moves the Controlled Runtime Experiments architecture Note from proposed to implemented;
- preserves the existing `mcp.enabled: true` seven-tool read-only contract unless experiment capability is explicitly enabled;
- documents DSH one-shot approval, external MCP bearer authority, finite Agent TTL, exact lease stop, exact `experimentId` trace filtering, and Human emergency stop;
- records the final real DSH fixture as a genuine SessionStore live session + open turn flowing through shipped ToolRuntime and ApprovalService rather than a session-shaped fake;
- keeps arbitrary runtime mutation, automatic reload/orchestration, remote MCP, payload capture, persistent approvals, renewal/concurrent leases, and non-waterfall profiling outside v0.6;
- does not publish npm, create a Git tag, or create a GitHub Release.

Repository readiness is therefore a statement about the checkout and CI state only.

## Alternatives considered

### Leave version metadata at 0.5.0 until npm publication

Rejected. Previous milestones already distinguish repository readiness from external publication. A fully implemented v0.6 checkout reporting `0.5.0` is internally misleading.

### Publish/tag as part of the closeout

Rejected because release actions were explicitly deferred. This change closes the repository milestone only.

### Keep the architecture Note in proposed after implementation

Rejected. The repository Note lifecycle requires accepted/landed decisions to move to implemented; keeping the proposed copy would leave contradictory active state.

### Weaken the real DSH proof back to a fake Agent session

Rejected. The real ToolRuntime correctly revealed that session authority is part of the execution path. The final fixture uses the public SessionStore lifecycle and real ApprovalService turn-enclosed audit contract.

### Expose experiment tools automatically on existing MCP configurations

Rejected. v0.5 backward compatibility is preserved: experiment authority must remain an explicit operator capability.

## Consequences

- A fresh checkout identifies itself consistently as repository version `0.6.0`, including MCP protocol metadata.
- README, product design, roadmap, parallel record, and architecture Note agree on the implemented authority/lifecycle boundary.
- Existing read-only MCP users do not silently gain new experiment tools or authentication requirements.
- DSH and external MCP Agents can run finite controlled waterfall experiments only through their truthful authority paths.
- The final CI gate includes policy, typecheck, tests, build, client bundle verification, the v0.5 real DSH regression, and the v0.6 real DSH controlled-experiment proof.
- npm publication, Git tags, and GitHub Releases remain absent until explicitly requested.