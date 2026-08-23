# Incident to Guardrail

Use this workflow after a material regression or failure exposes a reusable gap.

## 1. Reconstruct the external failure

Write what the user/runtime observed, not what the plugin claimed happened. Preserve logs, versions, profile composition, and the smallest reliable reproduction.

## 2. Identify the missing defense

Separate:

- trigger — what input/state exposed the bug;
- root cause — which invariant or assumption was wrong;
- detection gap — why existing tests/gates did not reject it;
- blast radius — what other paths share the same failure mode.

## 3. Write the postmortem

Create `docs/postmortem/YYYY-MM-DD-topic.md` using [the repository template](../../../docs/postmortem/README.md). Keep the timeline factual and blame-free.

## 4. Record the decision

If the fix establishes or changes a durable behavior/contract, create or update:

```text
.agents/notes/implemented/bug-fix/YYYY-MM-DD-topic.md
```

Record alternatives that were genuinely considered and why they lost.

## 5. Add the narrowest permanent defense

Prefer, in order:

1. a regression test that reproduces the real failure through the relevant entry path;
2. a static/CI gate when the invalid state is mechanically detectable before runtime;
3. a runtime assertion when only runtime state can establish the invariant;
4. a defensive-pattern rule when future code must know the hazard before editing the area.

Do not stop at prose if code can reject the bad state.

## 6. Verify the defense

Prove both sides when practical:

- the old/bad case is rejected or fails the regression test;
- the intended case still works through the real implementation.

Link the postmortem, Agent Note, and guardrail so a future cold-start agent can traverse the whole chain.
