# Lunchbench Claude Instructions

@AGENTS.md

Lunchbench is a greenfield lunch comparison app with Elo rankings.

## Required Reading

Before code changes, read the docs relevant to the task:

- Architecture: `docs/architecture.md`
- API contract: `docs/api-contract.md`
- Local setup: `docs/local-dev.md`
- E2E policy: `docs/e2e-testing.md`
- Development flow: `docs/10-agent-development-flow.md`
- CI: `docs/11-continuous-integration.md`
- D1 migrations: `docs/12-database-migrations.md`
- Environment config: `docs/13-environment-and-deployment-config.md`
- Communication style: `docs/15-caveman-compression-spec.md`

## Hard Rules

- Work in a git worktree.
- Keep changes scoped.
- Never commit secrets.
- Never bypass validation with `--no-verify`.
- Complete the review protocol in `docs/10-agent-development-flow.md` before merging.
- Run E2E before pushing product changes.
- Update docs when behavior, API, schema, deployment, or validation changes.

## Project Map

- `frontend/`: Vite + TypeScript SPA.
- `worker/`: Cloudflare Worker API using Hono.
- `migrations/`: D1 SQL migrations and local seed data.
- `e2e/`: Playwright tests.
- `scripts/run-e2e.sh`: Dockerized E2E harness.
