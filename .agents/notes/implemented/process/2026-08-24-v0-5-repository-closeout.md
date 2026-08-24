# Agent Note: v0.5 repository closeout

Status: implemented

## Problem

The Runtime Verification implementation and real DSH proof had landed, but repository-facing version metadata and product documentation still described `0.4.0` or the v0.5 work as planned. The proposed architecture Note also needed to close its lifecycle, and the final real-runtime correction that listener registration `order` is capture-local evidence had to be reflected consistently across active docs.

A repository closeout must make the checkout self-consistent without implying an npm publication, Git tag, or GitHub Release that has not occurred.

## Decision

Close the repository milestone at version `0.5.0` after the full Runtime Verification implementation and combined real DSH proof are present on `main`.

The closeout:

- sets `package.json` repository version to `0.5.0` and describes runtime diagnostics + verification;
- aligns the embedded MCP protocol server's reported version to `0.5.0`;
- documents the seven read-only Agent operations and the caller-owned checkpoint / semantic diff workflow;
- updates architecture and roadmaps from planned to implemented state;
- records the final Listener semantic key as event + owner name + `prepend` + `global`, with registration `order` retained only as capture-local evidence;
- moves the v0.5 Runtime Verification architecture decision from proposed to implemented;
- keeps controlled runtime experiments/profiler mutation outside v0.5;
- does not publish npm, create a Git tag, or create a GitHub Release.

Repository readiness is therefore a statement about the source tree and CI state only.

## Alternatives considered

### Leave package/version docs at 0.4.0 until an external release is published

Rejected. Repository versioning had already been used to mark repository-ready milestones independently from npm/tag publication. Leaving active source and docs on `0.4.0` after v0.5 is fully implemented makes the checkout internally misleading.

### Publish/tag as part of closeout

Rejected because the maintainer explicitly deferred release actions. Repository closeout must not imply external publication.

### Keep the original proposed architecture Note and add a second implemented summary

Rejected. Repository Note lifecycle explicitly requires accepted decisions to move from `proposed` to `implemented`; keeping both active would leave contradictory status.

### Preserve the original listener-order example in product docs as historical design intent

Rejected for active documentation. Real DSH evidence superseded that detail before repository closeout. Historical rationale is preserved in the implemented decision/bug-fix notes, while active docs must describe shipped semantics.

## Consequences

- A fresh checkout identifies itself consistently as repository version `0.5.0`, including MCP server protocol metadata.
- README, architecture, roadmap, parallel-development record, and Agent Notes agree on the implemented Runtime Verification boundary.
- Agents/users see seven read-only operations and do not infer that checkpoint comparison reloads or instruments the runtime.
- The final real DSH `2 → 1` verification result is documented using the same semantic identity rules enforced by tests.
- npm publication, Git tags, and GitHub Releases remain absent until explicitly requested.
- The next architecture decision can begin from a clean v0.5 baseline rather than carrying planned-vs-implemented ambiguity forward.