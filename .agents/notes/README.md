# Agent Notes

Agent Notes are the repository's durable memory for decisions and proposals: why a change exists, what alternatives lost, and what future agents should not re-litigate without new evidence.

## Path and lifecycle

Use this path form:

```text
.agents/notes/<lifecycle>/<class>/YYYY-MM-DD-topic.md
```

Lifecycle is encoded by the directory:

- `proposed/` — substantial future work that is not yet shipped.
- `implemented/` — the decision is part of the current repository. Keep factual names/paths current without rewriting the original decision.
- `rejected/` — a proposal was considered and declined; retain it only while its rationale prevents a plausible repeated mistake.
- `archived/` — an implemented historical record no longer authoritative for current behavior. Archived notes are frozen.

Classes are a closed set enforced by `scripts/verify-agent-notes.mjs`:

- `feature`
- `bug-fix`
- `simplification`
- `architecture`
- `process`
- `testing`

## When a note is required

A non-trivial change adds or updates at least one Agent Note in the same PR. This includes behavior, architecture, shared/runtime contracts, testing strategy, build/release process, CI, repository policy, persistent formats, or a decision likely to be revisited.

Pure wording fixes and mechanical local edits may be exempt. The PR gate deliberately uses a conservative mechanically detectable rule: changes under production code, tests, package/build configuration, scripts, or workflows require a changed active Agent Note.

## File format

Every active note starts exactly with:

```markdown
# Agent Note: <title>

Status: <status>
```

The status must match the lifecycle path.

### Proposed

```markdown
## Problem
## Proposal
## Alternatives considered
## Acceptance criteria
## Risks
```

### Implemented

```markdown
## Problem
## Decision
## Alternatives considered
## Consequences
```

Implemented notes describe shipped reality in the present tense. Do not leave proposal-only headings such as `## Proposal`, `## Acceptance criteria`, or `## Risks` in an implemented note.

### Rejected

Rejected notes keep proposal-time structure and use:

```text
Status: rejected — <one-line reason>
```

They must still contain `## Problem`, `## Proposal`, and `## Alternatives considered`.

### Archived

Archived notes retain `Status: implemented` and add:

```text
Archived: YYYY-MM-DD
```

Do not modify them after archival.

## Alternatives considered is mandatory

Every note records real alternatives and why they lost. Do not invent alternatives to satisfy the gate. A decision without defeated alternatives invites the next cold-start agent to repeat the same debate.

## Superseding decisions

Do not edit an implemented note into its opposite. Create a new note, state that it supersedes the prior decision, and link both with relative Markdown links. Git history is not the only copy of decision rationale.

## Verification

Run:

```sh
pnpm verify:notes
pnpm verify:links
```

Pull requests also run `pnpm verify:note-required` against the base branch.
