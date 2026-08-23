# Development Loop

Use this workflow for every development task in `dsh-cordis-devtools`. The goal is to make agent work resumable, reviewable, and bounded without forcing heavy ceremony onto trivial edits.

## 0. Classify the task

Classify before editing implementation code.

### Trivial

Examples: typo fixes, wording-only documentation edits, mechanical local renames, or an obviously local change with no reusable design decision.

For a trivial task:

1. make the smallest correct edit;
2. run the focused checks that can falsify it;
3. do not create an Agent Note unless the change actually carries a durable decision.

### Non-trivial

Examples: new behavior, runtime logic, shared contracts, tests that establish a new strategy, build/release behavior, CI/policy changes, or refactors that change architectural boundaries.

A non-trivial task uses the full loop below and carries an Agent Note in the same PR.

### Decision-sensitive

A non-trivial task is decision-sensitive when it changes architecture, public/shared contracts, Cordis dispatch semantics, lifecycle ownership, payload/privacy behavior, instrumentation semantics, persistent formats, or repository policy.

Decision-sensitive work has a mandatory maintainer checkpoint after the proposal unless the maintainer already explicitly approved that exact direction in the current task.

## 1. Discover

Understand the world before changing it.

1. Read `AGENTS.md` and relevant repository docs.
2. Inspect the current implementation and nearby tests.
3. Inspect upstream DSH/Cordis source or documentation when behavior depends on it.
4. Separate authoritative runtime facts from assumptions or self-reported metadata.
5. Identify constraints, unknowns, and the smallest useful scope.

Do not begin implementation merely because a plausible solution appeared early.

The discovery output should make these questions answerable:

- What happens now?
- What should happen instead?
- Which invariants must remain true?
- Which APIs or runtime facts support the design?
- What remains uncertain?

## 2. Propose

For non-trivial work, create or update:

```text
.agents/notes/proposed/<class>/YYYY-MM-DD-topic.md
```

Follow the format in [Agent Notes](../../notes/README.md). Record real alternatives and why they lose.

The proposal should define:

- the problem and desired observable behavior;
- the chosen boundary and scope;
- alternatives considered;
- acceptance criteria;
- verification evidence needed;
- known risks or unknowns.

Keep design at the level needed to constrain implementation. Do not pre-write speculative abstractions that are not required by the behavior.

## 3. Decision checkpoint

For decision-sensitive work, stop after the proposal and hand control back to the maintainer unless the maintainer has already approved the exact direction.

At this checkpoint, summarize only the decisions that need judgment:

- recommended approach;
- strongest rejected alternative;
- meaningful risk or compatibility cost;
- what will intentionally remain out of scope.

Do not treat silence, your own recommendation, or a passing CI check as architectural approval.

If new evidence invalidates an approved proposal later, stop expanding the patch, update the Agent Note, and surface the changed decision before continuing.

## 4. Implement narrowly

After the direction is approved or no explicit checkpoint is required:

1. implement only the agreed behavior;
2. keep unrelated refactors out of the patch;
3. preserve the standing orders in `AGENTS.md`;
4. add or update tests with the implementation;
5. prefer the real Cordis/DSH implementation over mocks when the behavior crosses that boundary;
6. keep unstable Cordis access behind the adapter layer;
7. do not add observability values that cannot be proven from available signals.

Implementation is allowed to reveal facts the proposal missed. When that changes the decision rather than a local detail, return to the proposal/checkpoint instead of silently changing architecture.

## 5. Verify

Follow [pre-push checks](../pre-push-checks/SKILL.md).

Choose evidence from the changed surface rather than running commands by habit. Typical evidence layers are:

1. focused unit tests for pure helpers;
2. real Cordis integration tests for listener/fiber/lifecycle behavior;
3. type checking for shared contracts;
4. built-artifact or DSH smoke paths for package/install behavior;
5. browser evidence once the client surface exists;
6. `pnpm verify:policy` for repository policy and decision evidence.

Never claim a check ran when it did not. Never weaken a failing gate merely because the implementation appears correct.

## 6. Self-review

Review the complete diff against the Agent Note before opening the PR.

Check at least:

- Did the implementation exceed the agreed scope?
- Is any abstraction unnecessary for current behavior?
- Did Cordis internal access escape `src/host/cordis-adapter.ts`?
- Are listeners, subscriptions, timers, and services lifecycle-owned?
- Are histories and caches bounded?
- Is sensitive payload data captured by default?
- Is any displayed diagnostic value inferred but presented as fact?
- Do tests exercise authoritative behavior and the relevant real entry path?
- Did implementation create a durable contract not recorded in the Note?

Fix discovered problems. A self-review that only reports issues without correcting them is incomplete unless the issue requires a maintainer decision.

## 7. Prepare the PR

The PR should contain:

- a concise description of observable behavior/process changes;
- the owning Agent Note;
- exact verification evidence;
- known limitations;
- intentionally deferred work.

Do not merge automatically unless the maintainer explicitly asks for it.

## 8. Close the decision lifecycle

When implementation is accepted, move the Note from:

```text
proposed/... → implemented/...
```

and convert proposal-only sections to the implemented format without rewriting the original decision.

If the proposal is declined:

```text
proposed/... → rejected/...
```

Preserve the rejection rationale when it prevents a plausible repeated mistake.

If a later decision replaces shipped behavior, create a new Note and cross-link the superseded one instead of rewriting history.

## State model

```text
CLASSIFY
   │
   ├─ trivial ───────────────► IMPLEMENT ─► VERIFY ─► DONE
   │
   └─ non-trivial
          ▼
       DISCOVER
          ▼
       PROPOSE
          ▼
   DECISION CHECKPOINT? ── yes ─► WAIT FOR MAINTAINER
          │                            │
          no/approved ◄───────────────┘
          ▼
       IMPLEMENT
          ▼
        VERIFY
          ▼
      SELF-REVIEW
          ▼
        PR READY
          ▼
 IMPLEMENTED / REJECTED
```
