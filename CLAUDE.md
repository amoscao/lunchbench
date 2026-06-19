# Lunchbench - Claude Instructions

## Mandatory: Read Before Starting Any Work

This project has a mandatory E2E testing policy. See **[docs/e2e-testing.md](docs/e2e-testing.md)**.

### Key rules:
- Never push code without running E2E tests (`./scripts/run-e2e.sh`)
- Never use `git push --no-verify`
- If tests fail for an unknown reason:
  1. Create a GitHub issue (label: `testing`, `pm`)
  2. Fix the issue immediately
  3. Do not bypass - fix it

## Project Summary

Lunchbench is a lunch comparison web app with Elo rankings, deployed on Cloudflare.

- **Worker API**: `worker/` (Hono + TypeScript)
- **Frontend SPA**: `frontend/` (Vite + TypeScript, no framework)
- **E2E Tests**: `e2e/` (Playwright in Docker)
- **Migrations**: `migrations/`
- **Docs**: `docs/`

## Architecture

See [docs/architecture.md](docs/architecture.md).

## API Contract

See [docs/api-contract.md](docs/api-contract.md).

## Design Spec

See [docs/design-spec.md](docs/design-spec.md). Claude makes all UI/UX decisions. Do not deviate from the spec without PM review.

## Secrets

See [docs/secrets.md](docs/secrets.md). Never commit secrets.

## Local Development

See [docs/local-dev.md](docs/local-dev.md).

## Deployment

See [docs/deployment.md](docs/deployment.md).
