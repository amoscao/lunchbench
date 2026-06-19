# Lunchbench Agent Guide

@/home/amos/.codex/RTK.md

Lunchbench is a greenfield lunch-ranking app. Keep changes small, direct, and aligned with the docs in this repo.

## Project Shape

- Frontend: `frontend/` Vite + TypeScript SPA.
- API: `worker/` Cloudflare Worker using Hono.
- Database: Cloudflare D1 with SQL files in `migrations/`.
- Images: Cloudflare R2 through Worker bindings.
- E2E: Playwright in Docker Compose through `./scripts/run-e2e.sh`.

## Work Rules

- Use a git worktree for branch work.
- Do not modify unrelated files.
- Do not bypass git hooks or validation.
- Never use `git push --no-verify`.
- Never commit secrets, `.dev.vars`, `.env*`, Playwright reports, or Wrangler state.
- Prefer the simplest implementation that satisfies the current docs.

## Docs To Read

- Product/API behavior: `docs/api-contract.md`
- Architecture: `docs/architecture.md`
- Local setup: `docs/local-dev.md`
- E2E policy: `docs/e2e-testing.md`
- Development flow: `docs/10-agent-development-flow.md`
- CI and release behavior: `docs/11-continuous-integration.md`
- D1 migration rules: `docs/12-database-migrations.md`
- Environment and deployment config: `docs/13-environment-and-deployment-config.md`
- Communication style: `docs/15-caveman-compression-spec.md`

If a task changes behavior, API shape, schema, deployment, or validation, update the matching doc in the same branch.
