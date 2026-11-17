# Secrets

## ADMIN_TOKEN
- **Purpose**: Protects `POST /api/admin/verify` (used to mint `SESSION_TOKEN`)
- **Generate**: `openssl rand -hex 32`
- **Add as Worker secret**: `npx wrangler secret put ADMIN_TOKEN` (enter value when prompted)
- **Add to `.dev.vars`**: `ADMIN_TOKEN=<value>` (never commit this file)
- **Do NOT share** this value publicly

## PURCHASER_PASSWORD
- **Purpose**: Password for the purchaser page `/chris`. Mints `purchaser` sessions that can read the weekly soda order list only.
- **Value**: chosen by the owner. Never write it into code, docs, tests, commits, PRs, or logs.
- **Add as Worker secret**: `npx wrangler secret put PURCHASER_PASSWORD` (enter value when prompted)
- **Add to `.dev.vars`**: `PURCHASER_PASSWORD=<any local value>` (never commit this file)

## IP_HASH_KEY
- **Purpose**: Optional HMAC key for the hashed client IP in rate-limit Sentry warnings. Unset means a random key per Worker isolate.
- **Generate**: `openssl rand -hex 32`
- **Add as Worker secret**: `npx wrangler secret put IP_HASH_KEY` (enter value when prompted)
- **Local**: not needed

## PROXY_SECRET
- **Purpose**: Optional shared secret between the Pages `/api` proxy and the Worker. With it, the Worker trusts the visitor IP the proxy forwards in `X-Lunchbench-Client-IP`, so per-IP rate limits are per visitor (#307). Missing or mismatched on either side means the Worker falls back to `CF-Connecting-IP` (site-wide limits, no errors). Details in `docs/13-environment-and-deployment-config.md`.
- **Set in both places, same value**: Worker `lunchbench-api` and Pages project `lunchbench`.
- **Before any block**: repo root, after `pnpm install`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exported. Each block pastes as is into bash or zsh.
- **Set or rotate** (one block; the value is never printed or written to a file, and `printf` is a shell builtin, so it is not in `ps`; the length check stops an empty value from being uploaded):
  ```bash
  PROXY_SECRET_VALUE="$(openssl rand -hex 32)"
  [ "${#PROXY_SECRET_VALUE}" -eq 64 ] && printf '%s' "$PROXY_SECRET_VALUE" | (cd worker && npx wrangler secret put PROXY_SECRET)
  [ "${#PROXY_SECRET_VALUE}" -eq 64 ] && printf '%s' "$PROXY_SECRET_VALUE" | (cd frontend && ../worker/node_modules/.bin/wrangler pages secret put PROXY_SECRET --project-name=lunchbench)
  unset PROXY_SECRET_VALUE
  ```
- **Redeploy Pages**: a Pages secret applies to new deployments only. Skip this if a Pages deploy is still to come (for example, the secret was set before merging the PR that needs it). Otherwise re-run the latest deploy (GitHub allows re-runs for 30 days; after that, push to `main`):
  ```bash
  RUN_ID="$(gh run list --workflow=deploy.yml --branch=main --limit 1 --json databaseId -q '.[0].databaseId')"
  gh run rerun "$RUN_ID"
  gh run watch "$RUN_ID" --exit-status
  ```
  The Worker secret changes at once. Until the new Pages deployment is live (a few minutes on rotation), the values differ and limits are site-wide. Nothing errors.
- **Check** (read-only, prints no IPs). After some site traffic, `egress_keys` (Cloudflare egress addresses) should be 0 or near it and `keys` should grow with visitors:
  ```bash
  (cd worker && npx wrangler d1 execute lunchbench --remote --command "SELECT action, COUNT(*) AS keys, SUM(key LIKE '2a06:98c0:%') AS egress_keys FROM rate_limits WHERE unixepoch(window_start) > unixepoch('now','-1 hour') GROUP BY action")
  ```
- **Local**: not needed. Never put it in a log, a Sentry event, a doc or a PR.

## CLOUDFLARE_API_TOKEN
- **Purpose**: Allows CI/CD (GitHub Actions) to deploy the Worker and Pages
- **Create at**: https://dash.cloudflare.com/profile/api-tokens
- **Required permissions**: Workers Scripts (Edit), Cloudflare Pages (Edit), D1 (Edit), R2 (Edit)
- **Add to GitHub**: Settings -> Secrets -> Actions -> CLOUDFLARE_API_TOKEN

## CLOUDFLARE_ACCOUNT_ID
- **Purpose**: Identifies your Cloudflare account in CI/CD
- **Find at**: dash.cloudflare.com -> right sidebar -> Account ID
- **Add to GitHub**: Settings -> Secrets -> Actions -> CLOUDFLARE_ACCOUNT_ID

## Security Notes
- Never commit .dev.vars
- Never commit actual secret values to any file
- Rotate API tokens if accidentally exposed
