# Agent Note: Adopt a lightweight agent-native development workflow

Status: implemented

## Problem

The repository is intended to be developed heavily with coding agents, but its initial scaffold only has ordinary source, tests, and CI. A cold-start agent can discover what the code does, yet it cannot reliably recover why architectural choices were made, which alternatives were already rejected, which checks prove a change, or how regressions should become durable defenses. Prose-only conventions would also rely on each agent remembering to follow them.

## Decision

The repository uses a lightweight agent-native workflow built around executable policy and durable decision records.

`AGENTS.md` is the concise standing-order entry point. `CLAUDE.md` points to the same file so tools with different repository instruction conventions receive one source of truth. Detailed rationale lives outside the standing orders.

Non-trivial changes add or update an Agent Note in the same pull request. Notes encode lifecycle in their path (`proposed`, `implemented`, `rejected`, `archived`), use a closed class set, and always record `## Alternatives considered`. Implemented notes preserve the decision while allowing factual paths and names to stay current; archived notes are frozen.

Repository scripts enforce the subset of the policy that is mechanically observable: Agent Note path/format/lifecycle, a minimum same-PR Note requirement for code/test/process surfaces, and valid repository-local Markdown links. CI executes these gates alongside type checking, tests, and build verification.

CI intentionally does not enable `actions/setup-node` dependency caching until the repository has a `pnpm-lock.yaml`; caching without a lockfile fails before repository gates can run. Once a lockfile becomes part of the repository contract, cache setup can be reintroduced with that file as its dependency key.

One repository skill defines the recurring pre-push workflow for selecting checks from evidence. `docs/defensive-patterns.md` holds durable defenses for failure-prone runtime areas, while ordinary regressions are expected to add the narrowest useful test, gate, runtime assertion, or defensive rule rather than a mandatory incident document.

The testing strategy grows in layers rather than copying DeepSeek Harness's full gate suite immediately: pure unit tests first, real Cordis integration next, built-plugin/DSH smoke tests when the bundle path is exercised, keyless runtime replay once stable trace fixtures exist, and browser snapshots once the Web UI exists.

## Alternatives considered

**Copy DeepSeek Harness's complete process immediately.** Rejected because this repository does not yet have the product surfaces that justify dozens of document gates, 100% per-file coverage, real-model e2e, bilingual pairing, snapshot replay, or stacked-PR automation. Empty ceremony would increase maintenance without protecting real behavior.

**Keep conventions only in README/AGENTS prose.** Rejected because rules that can be violated mechanically should fail mechanically. Agents are more reliable when a bad state is rejected than when a paragraph merely asks them not to create it.

**Keep ADR and RFC as separate document types.** Rejected for the current scale. Proposal and decision are one artifact with a lifecycle; moving the note gives a cold-start agent a clearer state model and avoids duplicate rationale.

**Require an Agent Note for every changed file.** Rejected because typo fixes and mechanical edits do not carry reusable rationale. The automated requirement targets code, tests, package/build config, scripts, and CI; maintainers can still require a Note for non-trivial documentation decisions.

**Require formal postmortems for material regressions now.** Rejected at the current repository scale. A dedicated postmortem template and incident skill add ceremony before there is enough operational history to justify them. If repeated or high-impact failures later show that bug-fix Notes plus regression defenses are insufficient, the repository can introduce a formal postmortem process then.

## Consequences

Every meaningful PR carries a small documentation cost, and process changes must update both code/gates and their owning note. This is intentional: decisions become repository data instead of conversational memory.

The workflow is deliberately incomplete. Coverage gates, real DSH e2e, keyless trace replay, browser snapshots, label taxonomy, stacked PR automation, bilingual documentation, and formal postmortems should be added only when concrete repository behavior or collaboration pressure creates a risk they can catch.

A regression is not complete when only the symptom is patched if the same class of failure can recur unnoticed. Add the narrowest reusable defense; use a `bug-fix` Agent Note when the fix establishes or changes a durable decision or contract.
