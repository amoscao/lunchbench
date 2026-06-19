# Agent Development Flow

## Goals

This file defines the normal agent workflow for Lunchbench changes.

The goals are:
- isolate work in a git worktree
- keep branches small
- validate before push
- open reviewable PRs
- avoid bypassing tests

## Required Flow

1. Read the relevant docs for the task.
2. Check repo status in the original checkout.
3. Create or use a dedicated worktree for the branch.
4. Create a branch named `codex/<short-description>`.
5. Make the smallest scoped change that satisfies the request.
6. Update docs when behavior, schema, API, deployment, or validation changes.
7. Run focused checks during development.
8. Run required validation before pushing.
9. Commit only intended files.
10. Push the branch.
11. Open a draft PR unless the user asks for ready-for-review.

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

## Stop Conditions

Stop and ask the user when:

- the requested behavior conflicts with existing docs
- production credentials are needed
- a destructive Cloudflare or database action is required
- validation fails for a reason that cannot be fixed within the task scope

Do not create broad refactors to avoid a narrow blocker.
