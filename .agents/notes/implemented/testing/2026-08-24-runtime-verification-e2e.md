# Agent Note: Runtime Verification combined real DSH E2E

Status: implemented

## Problem

v0.5 needs one end-to-end proof that the in-process DSH Agent path and the external MCP path can carry independent caller-owned baselines across the same real Cordis lifecycle transition and report the same semantic change. Separate fake snapshots or separate runtime processes would not prove that both adapters observe the same authoritative DSH instance.

## Decision

Extend the existing real DSH Web smoke to install the dedicated `runtime-verification-probe` and drive its test-only duplicate-Fiber transition from two live copies to one.

Before the transition, the in-process `CordisRuntime` provider captures its own checkpoint through the real `cordisInspect` registry, while an external official MCP SDK client captures a separate checkpoint through `cordis_capture_checkpoint`. Both baselines must contain two same-name live Fibers and two listeners for the verification event.

The test then creates the fixture signal file beneath the disposable `DSH_HOME`, causing the fixture to dispose exactly one live Fiber. After that same authoritative transition, DSH calls `compareCurrent` through `cordisInspect`, and the external client calls `cordis_compare_current` through the embedded loopback MCP server.

Both paths must independently report the same semantic facts: event listener count `2 -> 1`, equivalent listener-group multiplicity `2 -> 1`, and equivalent Fiber-group multiplicity `2 -> 1`. The E2E compares only this semantic summary, not capture-local ids/uids, listener registration order, timestamps, or digests. In particular, this locks the corrected listener identity semantics: registration order remains checkpoint evidence but does not split semantically equivalent duplicate listeners across checkpoints. The existing Human DevTools and waterfall-profiler browser assertions remain in the same DSH process after verification.

## Alternatives considered

- Run DSH Inspect and MCP verification in separate tests or separate DSH processes. Rejected because that would not prove both adapters observe the same transition.
- Compare complete checkpoint/comparison JSON byte-for-byte. Rejected because timestamps, digests, and capture-local ids/uids are not cross-capture semantic identity.
- Add a production mutation tool to trigger disposal. Rejected because v0.5 remains read-only; the transition is controlled only by the E2E fixture.
- Invoke a real model/Agent. Rejected because adapter correctness and runtime evidence can be proven deterministically without API keys or nondeterministic model behavior.

## Consequences

The repository has a deterministic real-DSH proof of the v0.5 verification loop across both Agent-facing transports. A failure in checkpoint capture, fresh-current comparison, semantic multiplicity, DSH `cordisInspect`, external MCP, or the shared real runtime transition is visible in one integration test. Human UI and existing waterfall profiling also remain covered by the same smoke.

This test does not claim a root cause, a successful code fix, or a confidence score. It adds no production mutation surface and does not change profiler instrumentation semantics.
