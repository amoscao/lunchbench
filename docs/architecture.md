# Lunchbench Architecture

## Overview

Lunchbench runs entirely on the Cloudflare free tier. It has four components:

| Component | Product | Purpose |
|-----------|---------|---------|
| Frontend | Cloudflare Pages | Static SPA (Vite + TypeScript) |
| API | Cloudflare Worker | REST API (Hono + TypeScript) |
| Database | Cloudflare D1 | SQLite database for lunches/votes |
| Images | Cloudflare R2 | Object storage for uploaded images |

## Request Flow

```
Browser
  → Cloudflare Pages (static assets + /api/* proxy)
    → Cloudflare Worker (Hono API)
      → D1 (reads/writes for lunch data, votes, soda swipes/reports, rate limits)
      → R2 (image reads/writes)

Cloudflare cron trigger (Monday 12:00 UTC)
  → Worker scheduled handler
    → D1 (writes the weekly soda order snapshot)
```

## Sodabench

Sodabench ranks canned sodas and seltzers. It shares the Worker, D1 database, and R2 bucket with the lunch app.

- `/soda`: voters swipe a 20-card deck (right = like, left = not a like) and report drinks they had (like or hate).
- `/leaderboard/soda`: public ranking. `/leaderboard` keeps the lunch ranking; tabs switch between them.
- `/chris`: purchaser page behind `PURCHASER_PASSWORD`. Shows the lunch PDF export and this week's order list.

Code:

- `worker/src/soda-score.ts`: Beta-posterior scoring with a hierarchical brand prior (pure). See the Scoring section of `docs/api-contract.md`.
- `worker/src/soda-order.ts`: weekly order list selection, seeded Thompson sampling for trials (pure).
- `worker/src/soda-deck.ts`: per-voter deck order (pure).
- `worker/src/soda-data.ts`: D1 aggregation and snapshot writes.
- `worker/src/routes/soda.ts`: `/api/soda/*` routes.
- `worker/src/index.ts`: exports `{ fetch, scheduled }`. The scheduled handler writes the weekly snapshot and prunes unknown scans older than 180 days.
- `worker/src/barcode.ts`: UPC/EAN normalization to 13-digit GTINs (pure). `frontend/src/utils/barcode.ts` has the same rules.
- `worker/src/soda-unknown-scans.ts`: groups the unknown-scan log for the admin view (pure).
- `frontend/src/components/barcode-scanner.ts`: scan mode of the report modal. Camera preview, decode loop, lookup, unknown-scan logging.
- `frontend/src/utils/zxing-decoder.ts`: fallback decoder (zxing-wasm), loaded only when scanning starts on a browser without `BarcodeDetector`.

Data:

- D1 tables: `sodas`, `soda_swipes` and `soda_reports` (one row per voter per drink each; a newer swipe or report replaces the older one), `soda_buy_lists` (frozen weekly order snapshots), `soda_barcodes` (code to drink) and `soda_unknown_scans` (scans that matched no code).
- `scripts/data/sodas.json`: cleaned catalog with Walmart image URLs. Images are not committed.
- `scripts/import-sodas.mjs`: generates `migrations/0012_soda_catalog.sql` and uploads images to R2 (`--local` or `--remote`). Image keys are `images/<uuidv5 of the Walmart item URL>.<ext>`, so the migration and the uploads agree.
- `scripts/import-barcodes.mjs`: one-off import of retail barcodes from Open Food Facts into `scripts/data/soda-barcodes.json`, and generates `migrations/0014_soda_barcodes_seed.sql`.
- The SPA Content-Security-Policy blocks hotlinked Walmart images. All drink images go through `GET /api/images/:key`.

### Barcode scanning

- Decoding runs on the device. Camera frames go from the `<video>` to the decoder and nowhere else. The server only receives the decoded digit string, its symbology, the drink id and the verdict.
- Decoder: native `BarcodeDetector` (formats `upc_a`, `upc_e`, `ean_13`, `ean_8`) when it supports them (Chrome on Android). Otherwise `zxing-wasm` (ZXing C++ as WebAssembly, reader build), bundled by Vite and served from our origin. Its default CDN `locateFile` is overridden. It is a dynamic import, so the ~36 kB JS chunk and the ~947 kB `.wasm` (~410 kB gzip) download only when scanning starts. It runs on the main thread, so frames are downscaled to 960 px on the long side and the slower `tryHarder` pass runs on every other frame only.
- Camera and decoder start in parallel. The preview shows as soon as the camera opens; a stop while the decoder is still loading still ends every track. A track that ends on its own (device lost) drops the modal to manual search.
- Lookup is local: `GET /api/soda/barcodes` once per page load.

### SPA Content-Security-Policy

Set by `frontend/functions/_middleware.ts` on HTML responses:

- `script-src 'self' 'wasm-unsafe-eval' https://gc.zgo.at`. `'wasm-unsafe-eval'` lets the barcode decoder compile WebAssembly. It does not allow `eval()` or `new Function()`.
- No `worker-src`: the decoder runs on the main thread, no workers or `blob:` scripts.
- `connect-src 'self'` covers the `.wasm` fetch.
- No `Permissions-Policy` header is set, so camera access is not blocked. If one is added, it must allow `camera=(self)`.
- `getUserMedia` needs HTTPS. Production is HTTPS; local `localhost` counts as secure.

## Resource Names

| Resource | Name |
|----------|------|
| Worker | `lunchbench-api` |
| D1 Database | `lunchbench` |
| R2 Bucket | `lunchbench-images` |
| Pages Project | `lunchbench` |

## Environments

### Local Development
- Worker: `wrangler dev` on port 8787
- Frontend: `vite dev` on port 5173
- D1: local SQLite file (managed by Wrangler)
- R2: local simulation (managed by Wrangler)
- Secrets: `.dev.vars` file (never committed)

### Preview
- Automatically deployed on PRs via Cloudflare Pages preview URLs
- Worker is shared (preview Pages points to production worker)

### Production
- Worker deployed via `wrangler deploy`
- Frontend deployed via Cloudflare Pages connected to GitHub main branch
- D1 and R2 are production Cloudflare resources

## API Proxy

The frontend proxies `/api/*` requests to the worker using a Cloudflare Pages Function at `frontend/functions/api/[[path]].ts`. This avoids CORS issues and keeps the API under the same domain.

## Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `ADMIN_TOKEN` | Worker secret + `.dev.vars` | Protects lunch creation and image upload routes |
| `PURCHASER_PASSWORD` | Worker secret + `.dev.vars` | Mints `purchaser` sessions for `/chris` and `GET /api/soda/order/latest` |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Allows CI to deploy worker and pages |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Identifies Cloudflare account in CI |

## Free Tier Limits (as of 2024)

| Resource | Free Limit | Expected Usage |
|----------|------------|----------------|
| Workers requests | 100,000/day | ~1,000/day |
| D1 reads | 5M/day | ~10,000/day |
| D1 writes | 100K/day | ~1,000/day |
| R2 storage | 10 GB | < 1 GB |
| R2 operations | 1M/month | < 10,000/month |
| Pages builds | 500/month | < 50/month |

Expected usage is well within free tier limits for 0-20 daily active users.
