# Development Workflow

This repository is designed for repeated collaboration between a maintainer and coding agents. The workflow separates **judgment** from **execution** so fast implementation does not outrun architectural control.

The executable procedure lives in [development-loop](../.agents/skills/development-loop/SKILL.md). This document explains the collaboration model and why the checkpoints exist.

## Roles

### Maintainer owns judgment

The maintainer decides:

- which problem is worth solving;
- where scope stops;
- architectural and compatibility tradeoffs;
- acceptable privacy/runtime risk;
- user-facing behavior;
- whether a decision-sensitive proposal is accepted;
- whether a PR is merged.

The maintainer should spend most review attention on behavior, boundaries, evidence, and rejected alternatives rather than reproducing the agent's implementation labor line by line.

### Agent owns execution

The agent should normally handle:

- repository and upstream source investigation;
- API and runtime behavior verification;
- proposal drafting;
- implementation;
- tests and edge cases;
- policy/document synchronization;
- verification and CI diagnosis;
- complete-diff self-review;
- PR preparation.

The agent is not the final authority for architecture merely because it can implement its own recommendation.

## The default loop

```text
Maintainer defines goal / constraints
              │
              ▼
         Agent discovers
              │
              ▼
        Proposed Agent Note
              │
              ▼
   Maintainer decision when needed
              │
              ▼
       Narrow implementation
              │
              ▼
       Evidence-based verify
              │
              ▼
          Agent self-review
              │
              ▼
             PR
              │
              ▼
       Maintainer acceptance
              │
              ▼
       Implemented Agent Note
```

## Why proposal comes before implementation

A coding agent can produce a large patch much faster than a maintainer can review it. The cheapest place to reject a bad direction is therefore the decision record, before hundreds of lines of implementation make the direction expensive to unwind.

A useful proposal answers:

- what observable problem is being solved;
- what architecture boundary changes;
- which alternatives were considered;
- what evidence will prove the behavior;
- what is explicitly out of scope.

It should not become a speculative implementation plan for details that do not affect the decision.

## Why not every task waits for approval

Mandatory human approval for every rename or local bug fix would turn the process into ceremony. The development loop therefore distinguishes:

- **trivial** work — small mechanical/local edits;
- **non-trivial** work — changes carrying reusable behavior or design rationale;
- **decision-sensitive** work — architecture, contracts, semantics, lifecycle, privacy, instrumentation, persistent formats, or repository policy.

Only the last category requires a hard proposal checkpoint unless the maintainer already approved the exact direction in the task itself.

## What the maintainer should review

For a decision-sensitive proposal, focus on four questions:

1. Does this solve the right problem?
2. Is the boundary/scope appropriate?
3. Is a simpler alternative being rejected for a good reason?
4. Is the verification plan capable of proving the real behavior?

For the resulting PR, focus on:

- whether the diff still matches the Note;
- whether verification exercised authoritative state and the real entry path;
- whether the implementation introduced new contracts or risk silently;
- whether intentionally deferred work is acceptable.

## What the agent should self-review

Before PR creation, the agent checks for scope creep, unnecessary abstractions, lifecycle leaks, unbounded histories, sensitive payload capture, Cordis-internal leakage, unprovable observability values, and tests that only validate mocks or self-reported metadata.

The purpose is not to replace maintainer review. It is to remove implementation-level noise so maintainer attention stays on judgment.

## Agent Notes are the state and memory

The Note path records the decision lifecycle:

```text
proposed/
   │
   ├─ accepted + shipped ─► implemented/
   │
   └─ declined ───────────► rejected/
```

A later replacement creates a new Note and links the old decision instead of rewriting history. This allows a cold-start agent to recover not only what exists, but why competing approaches were rejected.

## Verification is evidence, not ritual

The repository deliberately avoids a single mandatory full test sequence for every edit. The agent uses [pre-push checks](../.agents/skills/pre-push-checks/SKILL.md) to choose the smallest evidence set capable of falsifying the changed behavior.

Examples:

- pure helper → focused unit test;
- Cordis listener lifecycle → real Cordis integration test;
- package/install path → built artifact / DSH smoke path;
- repository process → policy gates;
- future client behavior → browser evidence.

A failed check is evidence to diagnose, not an obstacle to disable.

## Useful maintainer prompts

The process should reduce prompt ceremony. Typical instructions can be short:

```text
按 development-loop 做这个功能，先做到 proposal/checkpoint 阶段。
```

After review:

```text
方案通过，继续 development-loop。完成实现、验证、自审并开 PR，不要 merge。
```

For a clearly local task:

```text
这是 trivial 修改，按 development-loop 的轻量路径处理。
```

The repository carries the rest of the procedure.
