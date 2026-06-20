# Deployment

## Manual Deployment

### Deploy Worker
```bash
cd worker
npx wrangler deploy
```

### Deploy Frontend
```bash
cd frontend
pnpm build
npx wrangler pages deploy dist --project-name=lunchbench --branch=main
```

### Apply Production Migrations
```bash
cd worker
npx wrangler d1 execute lunchbench --remote --file=../migrations/0001_initial.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0002_add_description.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0003_add_vegan.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0004_admin_sessions.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0005_glicko.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0006_glicko_defaults.sql
```

## Automated Deployment (GitHub Actions)

On push to `main`, the `.github/workflows/deploy.yml` workflow:
1. Runs tests
2. Builds the frontend
3. Deploys the Worker
4. Deploys the frontend to Pages

### Required GitHub Secrets
| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers, Pages, D1, R2 permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Add these at: https://github.com/amoscao/lunchbench/settings/secrets/actions

## Production Resources
- Worker: https://lunchbench-api.woodamca.workers.dev
- Pages: https://lunchbench.pages.dev (once Pages is deployed)
- D1 Database: lunchbench (ab999e13-bac3-47b8-8246-b5e9aa82a8b3)
- R2 Bucket: lunchbench-images (pending R2 activation)

## Enabling R2 (pending human action)
1. Go to https://dash.cloudflare.com -> R2 -> Enable
2. Create bucket: `lunchbench-images`
3. In `worker/wrangler.toml`, uncomment the `[[r2_buckets]]` section
4. Run `npx wrangler deploy` again
