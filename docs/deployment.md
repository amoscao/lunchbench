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
npx wrangler d1 execute lunchbench --remote --file=../migrations/0015_remove_olipop.sql
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
2. Load the barcode seed. Data only, `INSERT OR IGNORE`. Needs `0012_soda_catalog.sql` already applied. Any re-run of 0012 or 0014 must be followed by 0015. Otherwise the 9 OLIPOP drinks or their 19 seed barcode mappings come back, and those mappings block voter learning for the codes (`ON CONFLICT DO NOTHING`).
   ```bash
   cd worker
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0014_soda_barcodes_seed.sql
   ```
3. Merge. The Pages deploy ships the new CSP (`'wasm-unsafe-eval'`) and the bundled decoder in the same release as the scanner.

If the PR merges before step 1, `GET /api/soda/barcodes` and the unknown-scan routes return 500, every scan falls back to manual search, and reports that carry a barcode fail. Before step 2, scans only match codes that voters or admins map.

`seed.sql` is for local dev and E2E only. Do not apply it to production.

### Remove OLIPOP (issue #296)
Run with the owner's go-ahead, from `worker/`, in this order. 0015 only touches data that the current Worker already filters, so it is safe before or after the PR merges.

1. Note a restore point first. 0015 is destructive for barcodes: it deletes every `soda_barcodes` row of the 9 drinks, including voter- and admin-learned mappings, not just the seed ones.
   ```bash
   npx wrangler d1 time-travel info lunchbench
   ```
   Keep the bookmark it prints. `wrangler d1 time-travel restore lunchbench --bookmark=<bookmark>` undoes the step if needed, but it restores the whole database: every write made after the bookmark (lunch votes, soda swipes and reports) is lost.
2. Deactivate the drinks and drop their barcodes:
   ```bash
   npx wrangler d1 execute lunchbench --remote --file=../migrations/0015_remove_olipop.sql
   ```
3. Clear this week's frozen order list if it still names OLIPOP. Snapshots store their own `image_key`, so a stale OLIPOP row would keep showing on `/chris`, with a broken image once step 4 runs. Check:
   ```bash
   npx wrangler d1 execute lunchbench --remote --command "SELECT week_start FROM soda_buy_lists WHERE items_json LIKE '%\"brand\":\"OLIPOP\"%' ORDER BY week_start DESC"
   ```
   If the current week (the latest `week_start`) is listed, delete that snapshot and let it rebuild:
   ```bash
   npx wrangler d1 execute lunchbench --remote --command "DELETE FROM soda_buy_lists WHERE week_start = '<week>'"
   ```
   Then load `/chris` once. `GET /api/soda/order/latest` rebuilds a missing current week (`writeWeeklyOrder(..., 'keep')`) from the active drinks only. Older weeks need nothing.
   **Do not run step 4 until `/chris` shows no OLIPOP.**
4. Delete the 9 images. The keys are `images/<uuidv5 of the Walmart item URL>.<ext>`, the same ones 0012 stored in `sodas.image_key` (`node scripts/import-sodas.mjs keys` derived them before OLIPOP left `sodas.json`).
   ```bash
   npx wrangler r2 object delete lunchbench-images/images/73016f37-2dc2-59cb-a628-9d8193690278.jpg   # OLIPOP Cherry Cola
   npx wrangler r2 object delete lunchbench-images/images/deaf3232-53ec-5206-80fb-5838ded36d0e.jpg   # OLIPOP Classic Grape
   npx wrangler r2 object delete lunchbench-images/images/71659a2f-06a0-5f27-9620-1f1eb31b0831.jpg   # OLIPOP Classic Root Beer
   npx wrangler r2 object delete lunchbench-images/images/fca5f04e-bf6c-56af-bc93-c280bd36506e.jpg   # OLIPOP Cream Soda
   npx wrangler r2 object delete lunchbench-images/images/1af5b70f-48ef-58c2-8826-7ee64923a3e8.jpg   # OLIPOP Crisp Apple
   npx wrangler r2 object delete lunchbench-images/images/d4e26c58-7068-58d7-a51d-8a2c25f36c11.png   # OLIPOP Orange Cream
   npx wrangler r2 object delete lunchbench-images/images/c3e658c1-d235-54fa-bf67-39a51dee818a.jpg   # OLIPOP Pomegranate Sparkle
   npx wrangler r2 object delete lunchbench-images/images/94e0917f-a4e5-5d28-a22c-9f3a47fc962d.jpg   # OLIPOP Strawberry Vanilla
   npx wrangler r2 object delete lunchbench-images/images/8ea569f5-d4e8-5a3e-9afd-167de89aef9f.jpg   # OLIPOP Vintage Cola
   ```
   The repo's wrangler (3.114.17) targets the remote bucket when `--local` is absent. Its `r2 object delete` defines only `--local`, `--persist-to` and `--jurisdiction`, with no `--remote`. With wrangler 4+, where local is the default, append `--remote`. For a local R2, append `--local` instead.

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
