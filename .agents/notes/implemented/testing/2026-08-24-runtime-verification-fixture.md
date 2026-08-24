# Agent Note: Runtime Verification transition fixture

Status: implemented

## Problem

v0.5 needs one deterministic real-Cordis lifecycle transition that later DSH Inspect and external MCP tests can observe against the same running DSH process. The existing duplicate-Fiber fixture proves a `2` state but has no externally orchestratable transition to `1`.

## Decision

Add an E2E-only DSH plugin fixture under `e2e/fixtures/runtime-verification-probe`.

The fixture creates two same-name live child Fibers. Each owns one listener for the same verification event and emits that event periodically. While running under the disposable DSH profile, it watches one file beneath `DSH_HOME`. When the test orchestrator creates that file, the fixture disposes exactly one duplicate Fiber, logs a deterministic completion marker, and leaves the other live instance intact.

The control file exists only as test orchestration. It is not part of production diagnostics, Agent APIs, checkpoint contracts, or package files. The main `e2e/dsh-web-smoke.mjs` is intentionally not edited in this workstream; final orchestration remains owned by the later combined v0.5 E2E PR.

## Alternatives considered

- Use a fixed timeout to dispose one duplicate. Rejected because baseline capture timing would race hosted CI and external MCP setup.
- Add a production mutation/RPC tool to trigger the transition. Rejected because v0.5 is read-only and E2E control must not leak into product behavior.
- Reuse only the existing duplicate-Fiber fixture and infer a transition. Rejected because verification requires a real authoritative `2 -> 1` lifecycle change.

## Consequences

The final v0.5 integration test can control the exact transition point from the test process without model credentials or product mutations. Both Agent paths can capture baselines before the signal and compare after the same real Cordis disposal. The fixture remains outside the published package `files` list and does not alter current production runtime behavior.
