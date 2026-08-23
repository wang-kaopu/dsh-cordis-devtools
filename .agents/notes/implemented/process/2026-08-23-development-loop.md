# Agent Note: Standardize the maintainer-agent development loop

Status: implemented

## Problem

The repository already has Agent Notes, policy gates, and a pre-push verification skill, but it does not yet define one end-to-end collaboration procedure for turning a maintainer request into investigation, a decision record, implementation, verification, self-review, and a PR. Without a standard loop, each new agent session may re-negotiate when to write a Note, when to stop for architectural approval, what the maintainer is expected to review, and when the agent may continue autonomously.

A single rigid workflow for every edit would create the opposite problem: trivial fixes would inherit the same ceremony as architecture or runtime-semantic changes.

## Decision

The repository adopts `.agents/skills/development-loop/SKILL.md` as the default development SOP and documents the maintainer/agent responsibility split in `docs/development-workflow.md`.

The loop classifies work as trivial, non-trivial, or decision-sensitive before implementation. Trivial work takes a lightweight implement-and-verify path. Non-trivial work carries an Agent Note and follows discovery, proposal, implementation, verification, self-review, PR preparation, and lifecycle closure.

Decision-sensitive work adds a hard maintainer checkpoint after proposal when it changes architecture, public/shared contracts, Cordis dispatch semantics, lifecycle ownership, payload/privacy behavior, instrumentation semantics, persistent formats, or repository policy. The checkpoint is waived when the maintainer has already explicitly approved the exact direction in the current task.

`AGENTS.md` routes non-trivial development work into the development-loop skill instead of duplicating the full procedure. The existing pre-push skill remains a focused verification subroutine used by the development loop.

The agent is expected to own investigation, implementation, testing, verification, self-review, and PR preparation. The maintainer retains ownership of problem selection, scope boundaries, architecture/risk tradeoffs, acceptance of decision-sensitive proposals, and merge decisions.

The self-review stage explicitly checks for scope creep, unnecessary abstraction, Cordis-internal leakage, lifecycle ownership, unbounded histories, sensitive payload capture, unprovable observability values, and tests that validate mocks or self-report instead of authoritative behavior.

## Alternatives considered

**Put the complete workflow directly in `AGENTS.md`.** Rejected because standing orders should remain small enough to stay in every agent context. The root file should route agents to a detailed SOP rather than becoming a long handbook.

**Document the process only in `docs/development-workflow.md`.** Rejected because explanatory documentation is useful to humans and cold-start agents, but a reusable Skill is a clearer executable work procedure and can be directly referenced in future task prompts.

**Require a maintainer approval stop after every non-trivial Agent Note.** Rejected because local non-trivial work that does not carry a meaningful architecture/risk choice would generate unnecessary round trips. A hard stop is reserved for decision-sensitive work, while a maintainer can always request an earlier checkpoint.

**Allow the agent to approve its own proposal and continue through merge.** Rejected because the workflow is designed to separate fast execution from scarce architectural judgment. The agent may continue implementation only when no decision-sensitive checkpoint is needed or when the maintainer already approved the direction; merge remains a maintainer decision unless explicitly delegated.

**Create one large skill that also embeds all verification details.** Rejected because verification policy already has a focused `pre-push-checks` skill. Keeping development-loop as orchestration and pre-push as a subroutine avoids duplicated rules and lets verification evolve independently.

## Consequences

Future task prompts can be much shorter because the repository now carries the collaboration protocol. A maintainer can ask an agent to “follow development-loop to the proposal stage” or approve a proposal and tell it to continue without restating the full process.

Decision-sensitive tasks deliberately include a human synchronization point, so they may require two interaction rounds even when an agent could technically implement the whole change at once. This is intentional because design mistakes are cheaper to reject before implementation.

The trivial path keeps small edits lightweight, but classification requires judgment. If uncertainty exists about whether a change affects architecture, runtime semantics, contracts, privacy, or repository policy, it should be treated as decision-sensitive rather than silently downgraded.
