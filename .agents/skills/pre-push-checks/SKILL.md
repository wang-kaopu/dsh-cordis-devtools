# Pre-push Checks

This is the verification subroutine used by [development-loop](../development-loop/SKILL.md). The goal is evidence, not ritual: run the smallest set that can falsify the changed behavior.

## 1. Inspect the change surface

```sh
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Identify whether the change affects policy/docs, pure helpers, Cordis runtime behavior, package/build output, or future client UI.

## 2. Run policy gates

For a non-trivial branch based on `main`:

```sh
VERIFY_BASE=origin/main pnpm verify:policy
```

If this fails, fix the note/link/policy evidence. Do not bypass a gate merely because the code itself works.

## 3. Select behavioral checks

- Pure helper/data structure: focused Vitest test, then `pnpm typecheck`.
- Cordis listener/fiber/lifecycle behavior: integration test against real `@deepseek-ai/cordis`; avoid a fake event bus.
- Shared type/API change: `pnpm typecheck` plus all consumers' tests.
- Package exports, build config, `cordis.patch.yml`, or install behavior: `pnpm build` and the built/packed smoke path once available.
- Client UI: client tests; browser verification once that layer exists.

## 4. Do not repeat stale evidence

A passing command stays valid until a later edit can affect what it proved. Do not rerun everything just because a commit or push is next.

## 5. Report evidence

In the PR, list the exact commands or real-world checks performed. Do not say “tests pass” if only one focused test ran; name it.

## Failure handling

If a check fails, diagnose the failure before weakening the check. When a failure reveals a reusable gap, add the narrowest regression test, gate, runtime assertion, or defensive rule that would have caught it. Update a `bug-fix` Agent Note when the fix changes a durable decision or contract.
