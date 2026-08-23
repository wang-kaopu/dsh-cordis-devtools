# AGENTS.md

`dsh-cordis-devtools` is a runtime inspector and event profiler for DeepSeek Harness / Cordis. Read [docs/architecture.md](docs/architecture.md) before changing runtime collection or public data types. Decisions and proposals live in [.agents/notes/](.agents/notes/README.md).

## Commands

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm verify:policy
```

Run the smallest check set that proves the changed behavior. Do not rerun a passing check unless later edits can invalidate it.

## Development workflow

Use [development-loop](.agents/skills/development-loop/SKILL.md) for development tasks. It classifies work as trivial, non-trivial, or decision-sensitive and defines discovery, Agent Note, implementation, verification, self-review, PR, and lifecycle steps. The human/agent responsibility split is explained in [docs/development-workflow.md](docs/development-workflow.md).

For decision-sensitive changes—architecture, public/shared contracts, Cordis dispatch semantics, lifecycle ownership, payload/privacy behavior, instrumentation semantics, persistent formats, or repository policy—stop after the proposal and wait for maintainer approval unless the maintainer already explicitly approved that exact direction in the current task.

## Standing orders

- **Observer mode must not change Cordis dispatch semantics.** v0.1 observes runtime state; listener wrapping, `next()` instrumentation, or dispatch replacement belongs to an explicit instrumented mode and requires an Agent Note.
- **Cordis internals stay isolated.** Direct access to experimental/internal Cordis fields such as `ctx.events._hooks` belongs in `src/host/cordis-adapter.ts`; the collector and UI consume our own types.
- **Never invent observability data.** If Cordis exposes dispatch start but not completion, do not report a duration. Unknown is better than inferred-but-presented-as-fact.
- **Verify the world, not a self-report.** Prefer authoritative runtime state such as Cordis listener/fiber registries over metadata a plugin reports about itself.
- **Registrations are lifecycle-owned.** Event listeners, services, timers, and subscriptions must have disposal tied to the owning Cordis fiber/effect.
- **Runtime histories are bounded.** New timelines, payload caches, and trace buffers need an explicit capacity or retention policy.
- **Do not capture sensitive payloads by default.** Observer mode records event/fiber metadata, not arbitrary event arguments, prompts, tool results, secrets, or file contents. Any payload capture requires an opt-in design note and redaction rules.
- **Keep host, shared, and client concerns separated.** Host collects; `src/shared` defines transport-neutral data; client presents. UI code must not reach into Cordis host internals.
- **Test the real entry path when behavior crosses a package boundary.** Unit tests are fine for pure helpers; integration tests should use the real Cordis implementation. Published-path changes must eventually exercise the built/packed plugin, not source-only imports.
- **Prefer real implementations over mocks.** Use a mock only when the real dependency cannot provide a deterministic test seam, and state why in the test.

## Agent Notes

Every non-trivial change to runtime behavior, architecture, shared types, testing strategy, build/release process, or repository policy MUST add or update an Agent Note in the same PR. Pure prose corrections and mechanical local edits are exempt. The executable gate defines the mechanically detectable minimum; see [.agents/notes/README.md](.agents/notes/README.md).

Record rejected alternatives. Do not rewrite an implemented note into a different decision; supersede it with a new note and cross-link them.

## Testing strategy

Use evidence in this order as the project grows:

1. Unit tests for pure data structures and transformations.
2. Integration tests against real `@deepseek-ai/cordis` for lifecycle/listener behavior.
3. Built-artifact smoke tests for package exports and DSH bundle loading.
4. Keyless recorded runtime fixtures when traces become stable enough to replay.
5. Browser snapshots when the Web DevTools surface ships.

Do not add a higher layer before there is real behavior for it to protect. When a regression exposes a reusable gap, add the narrowest regression test, gate, runtime assertion, or defensive rule that would have stopped it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before changing lifecycle handling, listener instrumentation, teardown, tracing, buffering, or payload capture. A `bug-fix` Agent Note is required when a fix changes a durable decision or contract, not for every ordinary bug fix.

## Agent workflows

Reusable procedures live under `.agents/skills/`:

- [development loop](.agents/skills/development-loop/SKILL.md) — orchestrate discovery → decision → implementation → verification → PR.
- [pre-push checks](.agents/skills/pre-push-checks/SKILL.md) — select checks from the changed surface and evidence needed during the verification phase.

All repository-local Markdown links are relative so `pnpm verify:links` can validate them. `CLAUDE.md` is a symlink to this file; keep one source of standing orders.
