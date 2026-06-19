# Tools

## Core Tools

Expected local tools:

- `git`
- `node`
- `pnpm`
- `npx`
- `docker`
- `rg`
- `sed`
- `find`
- `wrangler`
- `gh`

Use `rg` for search. Use `pnpm` for package scripts. Use `wrangler` for Cloudflare Worker, Pages, D1, and secret operations.

## Repo Commands

Install dependencies:

```bash
pnpm install
```

Build all workspaces:

```bash
pnpm build
```

Run API unit tests:

```bash
pnpm test
```

Run Dockerized E2E:

```bash
./scripts/run-e2e.sh
```

Install local git hooks:

```bash
./scripts/install-hooks.sh
```

## Cloudflare Commands

Run Worker locally:

```bash
cd worker
npx wrangler dev
```

Apply local D1 migrations:

```bash
cd worker
npx wrangler d1 execute lunchbench --local --file=../migrations/0001_initial.sql
```

Deploy Worker:

```bash
cd worker
npx wrangler deploy
```

Deploy Pages manually:

```bash
cd frontend
pnpm build
npx wrangler pages deploy dist --project-name=lunchbench --branch=main
```

## GitHub CLI

Use `gh` for issue and PR work when the GitHub app is not enough.

Useful commands:

```bash
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef
gh pr view --web
gh pr create --draft --fill
gh issue create
```

## Human-Only Tasks

A human should handle:

- Cloudflare billing or account setup
- R2 activation if the dashboard requires acceptance
- production secret values
- DNS ownership decisions
- deleting production resources

Agents may document the required action, but should not guess values or work around missing access.

## Tool Documentation Updates

Update this file when:

- package scripts change
- validation commands change
- Cloudflare resource names change
- a new required CLI is added
- a manual dashboard step becomes automated
