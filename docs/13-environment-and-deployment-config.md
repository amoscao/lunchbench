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

Used by admin authentication:

- `POST /api/admin/verify` mints a 1-year admin session token.
- `POST /api/lunches` and `POST /api/lunches/:id/image` require that session token in the `Authorization` header.

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

### `PURCHASER_PASSWORD`

Password for the purchaser page `/chris`.

- `POST /api/admin/verify` with this password mints a 1-year `purchaser` session.
- A `purchaser` session can read `GET /api/soda/order/latest` only. It has no admin or lunch powers.

Local value lives in `worker/.dev.vars`. E2E uses the placeholder `test-purchaser-password` from `docker-compose.e2e.yml`.

The production value is chosen by the owner. Never write it into code, docs, tests, commits, PRs, or logs. Set it as a Cloudflare Worker secret:

```bash
cd worker
npx wrangler secret put PURCHASER_PASSWORD
```

### `IP_HASH_KEY`

Optional. HMAC key for the `ip_hash` tag on rate-limit Sentry warnings (#262, see `docs/api-contract.md` "Rate Limit Monitoring"). Lets the hash group one IP across Worker isolates without being reversible by hashing every IPv4 address. Unset means a random key per isolate.

Production value is a Cloudflare Worker secret:

```bash
cd worker
npx wrangler secret put IP_HASH_KEY
```

Generate with:

```bash
openssl rand -hex 32
```

Rotating it changes every hash. Not needed locally.

### `PROXY_SECRET`

Optional. Shared secret between the Pages Function proxy and the Worker, so the Worker can trust the visitor IP the proxy forwards (#307).

Why: the proxy (`frontend/functions/api/[[path]].ts`) re-fetches the Worker at its `workers.dev` URL. The Worker's own `CF-Connecting-IP` is then a Cloudflare egress address shared by every visitor, so per-IP rate limits, barcode learning and the 429 `ip_hash` would be site-wide.

How it works:

- The proxy drops any client-sent `X-Lunchbench-Client-IP` and `X-Lunchbench-Proxy-Secret` headers.
- If the Pages project has `PROXY_SECRET`, the proxy sets `X-Lunchbench-Client-IP` to the `CF-Connecting-IP` it sees (the visitor) and `X-Lunchbench-Proxy-Secret` to the secret.
- `getClientIp` (`worker/src/rate-limit.ts`) uses `X-Lunchbench-Client-IP` only when the Worker has `PROXY_SECRET` and the header matches it (constant-time compare). Otherwise it uses `CF-Connecting-IP`, as before.
- A direct caller of the `workers.dev` URL does not know the secret, so it cannot choose its IP.

It must be set in both places, with the same value:

| Where | Name | Takes effect |
| --- | --- | --- |
| Worker `lunchbench-api` | `PROXY_SECRET` | at once (`wrangler secret put` deploys a new version) |
| Pages project `lunchbench`, production | `PROXY_SECRET` | on the next Pages deployment only |

Missing on either side, or the values differ: the Worker falls back to `CF-Connecting-IP`. Nothing errors, but limits are site-wide again, as before #307 (one visitor's failed admin logins can lock out everyone). Old code ignores the secret, so deploy order does not matter.

Set and rotate commands are in `docs/secrets.md` under `PROXY_SECRET`. One generated value goes to both places. It is never printed, never stored in a file, and never goes in docs, PRs or logs.

A Pages secret reaches only Pages deployments made after it is set. If the next Pages deploy is still to come (for example, the secret is set before merging the PR that needs it), nothing more is needed. Otherwise redeploy Pages: re-run the latest `Deploy to Cloudflare` workflow run on `main` (`gh run list --workflow=deploy.yml --branch=main --limit 1`, then `gh run rerun <run-id>`; GitHub allows re-runs for 30 days), or push to `main`.

Rotation: the Worker secret changes at once, the Pages one at the next Pages deploy. While they differ, limits are site-wide. The rotation steps in `docs/secrets.md` set the Pages secret first and the Worker secret only when the redeploy reaches its Pages step, to keep that window short.

Pages preview deployments do not get the secret (`wrangler pages secret put` sets production only), so previews keep site-wide limits.

Not needed locally. Local dev and E2E have no Pages Function: Vite proxies `/api` straight to `wrangler dev`, and the Worker uses `CF-Connecting-IP` there.

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

That file owns Worker name, compatibility date, D1 binding, R2 binding, and cron trigger configuration.

The `[triggers]` cron `0 12 * * 1` (Monday 12:00 UTC) runs the Worker `scheduled` handler, which writes the weekly Sodabench order snapshot. `wrangler deploy` registers the trigger. Locally, run `npx wrangler dev --test-scheduled` and request `/__scheduled?cron=0+12+*+*+1` to fire it.

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

The proxy forwards the visitor IP to the Worker when the Pages project has `PROXY_SECRET` (see Runtime Variables).

### `VITE_DISABLE_VEGAN_TOGGLE`

Build-time flag. When set to `true`:

- the nav omits the vegan mode toggle
- app start clears the saved `vegan-mode` localStorage key and the `data-vegan` attribute

Production sets it to `true` in the frontend build step of `.github/workflows/deploy.yml`.
Manual Pages deploys must build with `VITE_DISABLE_VEGAN_TOGGLE=true pnpm build` (see `docs/deployment.md`).
Local dev, CI, and E2E leave it unset, so the toggle stays visible there.

## API CORS

The Worker only emits browser CORS allow headers for known frontend origins.
Browser requests with any other `Origin` are rejected before route handling.
HTTP clients with no `Origin` header are still allowed.

- `https://lunchbench.xyz`
- `https://www.lunchbench.xyz`
- `https://lunchbench.pages.dev`
- `https://*.lunchbench.pages.dev`
- `http://localhost:5173`
- `http://localhost:4173`
- `http://127.0.0.1:5173`
- `http://127.0.0.1:4173`
- `http://frontend:5173`
- `http://[::1]:5173`
- `http://[::1]:4173`

Pages preview deployment URLs use the `*.lunchbench.pages.dev` pattern.
Local origins cover Vite dev and Vite preview.

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
4. Update GitHub Actions secrets, Cloudflare Worker secrets, or Pages project secrets if deployment needs them.
5. Update `docs/secrets.md` if the variable is secret.
