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
VITE_DISABLE_VEGAN_TOGGLE=true pnpm build
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
npx wrangler d1 execute lunchbench --remote --file=../migrations/0007_session_roles.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0009_matchup_sessions.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0011_sodabench.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0012_soda_catalog.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0013_soda_barcodes.sql
npx wrangler d1 execute lunchbench --remote --file=../migrations/0014_soda_barcodes_seed.sql
```

### Sodabench launch steps
`main` auto-deploys on push (`.github/workflows/deploy.yml`). Run ALL of these BEFORE merging the Sodabench PR, in this order:

1. Apply the schema. Additive; the current Worker ignores the new tables.
   ```bash
   cd worker
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0011_sodabench.sql
   ```
2. Upload the catalog images to the production bucket, from the repo root:
   ```bash
   node scripts/import-sodas.mjs upload --remote
   ```
   It downloads each image from its Walmart URL (or reads `--images-dir <dir>` files named `<walmart_item_id>.jpeg|png`) and puts it at the key the catalog migration uses.
3. Load the catalog:
   ```bash
   cd worker
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0012_soda_catalog.sql
   ```
   Upload images before (or together with) this step. A catalog row whose image is missing renders as a broken image.
4. Set the purchaser password (value chosen by the owner; never paste it anywhere else):
   ```bash
   cd worker
   npx wrangler secret put PURCHASER_PASSWORD
   ```
5. Merge. The deploy registers the Monday cron from `worker/wrangler.toml`. Until it first fires, `/chris` generates the current week's list on demand.

If the PR merges before step 1, the `/api/soda/*` routes return 500. Before step 3, the deck and soda leaderboard are empty. Before step 4, `/chris` accepts only the admin password.

### Barcode scanning launch steps
`main` auto-deploys on push. Run these BEFORE merging the barcode scanning PR (#294), in this order:

1. Apply the schema. Additive; the current Worker ignores the new tables.
   ```bash
   cd worker
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0013_soda_barcodes.sql
   ```
2. Load the barcode seed. Data only, `INSERT OR IGNORE`, safe to re-run. Needs `0012_soda_catalog.sql` already applied.
   ```bash
   cd worker
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0014_soda_barcodes_seed.sql
   ```
3. Merge. The Pages deploy ships the new CSP (`'wasm-unsafe-eval'`) and the bundled decoder in the same release as the scanner.

If the PR merges before step 1, `GET /api/soda/barcodes` and the unknown-scan routes return 500, every scan falls back to manual search, and reports that carry a barcode fail. Before step 2, scans only match codes that voters or admins map.

`seed.sql` is for local dev and E2E only. Do not apply it to production.

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
