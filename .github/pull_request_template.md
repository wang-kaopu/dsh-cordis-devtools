## What changed

<!-- Describe observable behavior and repository/process changes. -->

## Why

<!-- Link the owning Agent Note for non-trivial changes. -->

Agent Note: <!-- .agents/notes/... -->

## Verification

<!-- List exact commands or real-world checks. -->

- [ ] `pnpm verify:policy`
- [ ] `pnpm typecheck`
- [ ] Relevant tests
- [ ] `pnpm build` when package/build behavior changed

## Review checklist

- [ ] The change verifies authoritative runtime behavior rather than trusting self-reported metadata where that distinction matters.
- [ ] New Cordis internal access is isolated in the adapter layer.
- [ ] New listeners/subscriptions have lifecycle-owned disposal.
- [ ] New histories/caches are bounded.
- [ ] No sensitive runtime payload is captured by default.
- [ ] A non-trivial change adds or updates an Agent Note with real alternatives considered.
- [ ] A regression/incident adds the narrowest guardrail that would prevent recurrence.
