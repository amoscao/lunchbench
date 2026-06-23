# Continuous Integration

## Goals

Lunchbench CI should keep the app deployable without adding unnecessary process.

The goals are:
- run the same basic checks humans and agents run locally
- deploy `main` to Cloudflare
- keep E2E coverage as the main user-flow confidence check
- avoid hidden deploy behavior

## Current GitHub Actions Workflow

Current workflow inventory shows two active workflows:

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

The CI workflow runs on pull requests.

Current CI steps:

1. Check out the repo.
2. Set up pnpm.
3. Set up Node.js 24.
4. Install dependencies.
5. Run workspace unit tests with `pnpm test`.
6. Build the frontend.
7. Publish the required CI status.

The deploy workflow file is:

```text
deploy.yml
```

It runs on pushes to `main`.

Current steps:

1. Check out the repo.
2. Set up pnpm.
3. Set up Node.js 24.
4. Install dependencies.
5. Run workspace unit tests with `pnpm test`.
6. Build the frontend.
7. Deploy the Worker.
8. Deploy the frontend to Cloudflare Pages.

## Required Secrets

GitHub Actions requires:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The token must have enough permission to deploy Workers and Pages and to access the configured D1/R2 bindings.

## Local Validation

Local validation is still required before pushing meaningful code changes.

Use:

```bash
pnpm build
pnpm test
./scripts/run-e2e.sh
```

For docs-only changes:

```bash
git diff --check
```

## E2E Policy

Playwright E2E runs through Docker Compose:

```bash
./scripts/run-e2e.sh
```

E2E should cover user-facing changes. If a feature changes voting, leaderboard behavior, admin lunch creation, image upload, routing, or theme behavior, add or update E2E coverage in the same PR when practical.

Do not bypass E2E for product changes.

## Deployment Model

Lunchbench deploys from `main`.

- Worker deploy target: `lunchbench-api`
- Pages project: `lunchbench`
- D1 database: `lunchbench`
- R2 bucket: `lunchbench-images`

Feature branches do not require hosted preview infrastructure unless the project explicitly adds it later.

## CI Changes

When CI behavior changes, update:

- this file
- `docs/deployment.md`
- `docs/08-tools.md`
- `.github/workflows/deploy.yml`

Keep CI simple. Do not add extra jobs unless they catch real regressions for this repo.
