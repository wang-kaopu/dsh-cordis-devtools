# Postmortems

Use a postmortem for a material regression, data/privacy issue, broken release/install path, lifecycle leak, semantic instrumentation bug, or failure that reveals a missing repository defense.

The goal is not blame. The output is a reusable explanation and a stronger system.

## Template

Create `docs/postmortem/YYYY-MM-DD-short-title.md` with:

```markdown
# Postmortem: <title>

## Executive summary

## Impact

## Timeline

## Root cause

## Contributing factors

## Detection gap

## Guardrails

## Follow-up
```

`## Guardrails` must name the concrete regression test, verification script, invariant, or defensive rule added because of the incident. If the incident changes a decision or fills a missing contract, add/update a `bug-fix` Agent Note in the same PR and link it.

An incident is not closed by “fixed the code” alone when the same class of failure can recur unnoticed.

Follow the [incident-to-guardrail skill](../../.agents/skills/incident-to-guardrail/SKILL.md) for the workflow and add durable runtime rules to [defensive patterns](../defensive-patterns.md) when future code must know them before editing the affected area.
