# Defensive Patterns

This file records defenses for failure-prone runtime areas. Add a rule when a real incident, regression, or high-confidence failure mode proves the need. Prefer an executable test/gate beside the prose whenever possible.

## Observation must not become mutation

Observer mode may subscribe to Cordis signals and read runtime registries, but it must not wrap application listeners, replace dispatch methods, alter `next()`, reorder callbacks, or mutate event arguments. Instrumentation belongs to a separately enabled mode with dedicated tests.

## Do not manufacture timing

`internal/dispatch` is a pre-dispatch diagnostic signal. It does not by itself prove when a dispatch or listener completed. Never calculate or display duration from an event that has no corresponding completion observation.

## Read authoritative runtime state

When asking which listeners exist or which fiber owns a registration, prefer Cordis's actual runtime registry/context over plugin-declared metadata. A diagnostic tool that trusts the object it diagnoses can agree with a false self-report.

## Tie observers to lifecycle disposal

Listeners and subscriptions must be registered through Cordis lifecycle-owned mechanisms. HMR, plugin unload, and repeated activation must not leave duplicate observers or stale callbacks.

## Bound every history

Dispatch timelines and future trace stores need explicit limits. A developer tool that runs for hours must not turn observation volume into an unbounded memory leak.

## Capture metadata before payloads

Event names, dispatch modes, listener counts, fiber ids/names, and lifecycle states are the default observation surface. Raw arguments may contain prompts, credentials, file contents, tool results, or other sensitive data. Payload capture requires opt-in configuration, redaction policy, size limits, and an Agent Note.

## Keep the compatibility seam narrow

Unstable Cordis access belongs in `src/host/cordis-adapter.ts`. Do not scatter `_hooks` or other internal-field knowledge across collectors, shared types, and UI code.

## Preserve ordering when instrumenting

Future per-listener instrumentation must prove that prepend semantics, filtering, listener order, `this` binding, thrown/rejected errors, synchronous return behavior, and waterfall `next()` nesting remain equivalent when instrumentation is disabled and intentionally preserved when enabled.

## Teardown is part of correctness

Tests for runtime instrumentation should cover load → observe → dispose → reload, not only the happy loaded state. A feature that works once but duplicates after reload is broken.
