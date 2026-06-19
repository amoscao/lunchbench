# Agent Development Flow

## Goals

This file defines the normal agent workflow for Lunchbench changes, including the review protocol used for this greenfield project.

The goals are:
- isolate work in a git worktree
- keep branches small and easy to review
- validate before push
- open reviewable PRs
- avoid bypassing tests

## Required Flow

1. Read the relevant docs for the task.
2. Check repo status in the original checkout and note starting point.
3. Create or use a dedicated worktree and branch (`codex/<short-description>`).
4. Branch from current `main` and implement the smallest scoped change.
5. Update docs when behavior, schema, API, deployment, or validation changes.
6. Run required validation for the type of change (code vs docs).
7. Open a PR as soon as implementation is complete:
   - include clear description and validation done
   - include `Closes #<issue>` when applicable.
8. Run the review protocol (below).
9. Fix actionable review feedback in the same PR.
10. Re-run validation if behavior or routing changed.
11. Merge only when review loop has no actionable feedback.
12. Mark follow-up work in docs or issues if unresolved debt remains.

## Review Protocol

Use this protocol for PRs:

1. Add PR body with scope, ticket link, and validation already run.
2. Run a blind review pass (same ticket + PR context, independent of implementation details):
   - scope drift
   - feature drift
   - spec coverage gaps
   - architecture or security risk
   - unnecessary complexity
3. If the review has actionable fixes, patch the PR and re-run validation.
4. Run a second review pass focused on response to first feedback.
5. If changes were made, continue review cycles until no actionable feedback remains.
6. If an issue is fundamentally unsound, stop and re-scope or close the ticket.

Do not treat GitHub Actions as the only validation gate.
Use local checks for repo truth.

## Worktree Rule

Use worktrees for branch work:

```bash
git worktree add -b codex/<short-description> ../lunchbench-<short-description> main
```

If `main` has local commits that should be included, branch from the current local `main`. If it has unrelated uncommitted files, leave them behind.

## Validation

For code changes, run:

```bash
pnpm build
pnpm test
./scripts/run-e2e.sh
```

For docs-only changes, run at least:

```bash
git diff --check
```

If a docs-only change touches commands, workflow, or deployment instructions, inspect the referenced files and scripts so the docs match reality.

For PRs that are mostly docs, the review loop in this doc still applies even when test runs are not required.

## Commit Rules

- Do not use `git commit --no-verify`.
- Do not use `git push --no-verify`.
- Stage explicit file paths when the worktree contains unrelated changes.
- Keep commit messages short and descriptive.

Example:

```bash
git add docs/10-agent-development-flow.md
git commit -m "docs: add agent development flow"
```

## PR Rules

PR body should include:

- summary
- validation
- follow-ups, if any

Open draft PRs by default:

```bash
gh pr create --draft --fill
```

## PR Completion Rules

- Keep the PR open until both the implementation and review protocol are complete.
- Merge only after:
  - required local validation is run
  - review protocol has no unresolved actionable items
  - docs updated for any changed process behavior

## Stop Conditions

Stop and ask the user when:

- the requested behavior conflicts with existing docs
- production credentials are needed
- a destructive Cloudflare or database action is required
- validation fails for a reason that cannot be fixed within the task scope

Do not create broad refactors to avoid a narrow blocker.
