# Environment And Deployment Config

## Goals

This file documents Lunchbench environment variables, Cloudflare resources, and deployment configuration.

The goals are:
- keep local, CI, and production configuration clear
- avoid committing secrets
- document Cloudflare resource ownership
- keep deployment instructions aligned with the repo

## Environments

Lunchbench currently has two practical environments:

- local development
- production on Cloudflare

Feature branch previews are not required by default.

## Local Configuration

Local Worker secrets live in:

```text
worker/.dev.vars
```

Create it from:

```text
worker/.dev.vars.example
```

Never commit `.dev.vars` or `.env*` files.

## Runtime Variables

### `ADMIN_TOKEN`

Used by protected admin routes:

- `POST /api/lunches`
- `POST /api/lunches/:id/image`

Local value lives in `worker/.dev.vars`.

Production value is a Cloudflare Worker secret:

```bash
cd worker
npx wrangler secret put ADMIN_TOKEN
```

Generate with:

```bash
openssl rand -hex 32
```

### `CLOUDFLARE_API_TOKEN`

Used by GitHub Actions to deploy Worker and Pages.

Store only in GitHub Actions secrets.

Required access:

- Workers deploy
- Pages deploy
- D1 access
- R2 access when image storage is active

### `CLOUDFLARE_ACCOUNT_ID`

Used by GitHub Actions and Wrangler to identify the Cloudflare account.

Store in GitHub Actions secrets.

## Cloudflare Resources

Canonical resource names:

| Resource | Name |
| --- | --- |
| Worker | `lunchbench-api` |
| Pages project | `lunchbench` |
| D1 database | `lunchbench` |
| R2 bucket | `lunchbench-images` |

Update this file when a resource is renamed.

## Wrangler Configuration

Worker deployment config lives in:

```text
worker/wrangler.toml
```

That file owns Worker name, compatibility date, D1 binding, and R2 binding configuration.

Do not duplicate binding definitions in docs when `wrangler.toml` is the direct source of truth. Link to it or name the resource only.

## Frontend Configuration

The frontend is a Vite SPA under:

```text
frontend/
```

Local frontend dev server proxies `/api/*` to the Worker dev server.

Production uses Cloudflare Pages and the Pages Function proxy in:

```text
frontend/functions/api/[[path]].ts
```

## Deployment

Production deployment is handled by GitHub Actions on push to `main`.

Manual deploy commands live in:

- `docs/deployment.md`
- `docs/08-tools.md`

## Config Change Checklist

When adding or changing an environment variable:

1. Update this file.
2. Update `worker/.dev.vars.example` if it affects local development.
3. Update `worker/wrangler.toml` if bindings change.
4. Update GitHub Actions secrets or Cloudflare Worker secrets if deployment needs them.
5. Update `docs/secrets.md` if the variable is secret.
