# E2E Testing Policy

## Overview

Lunchbench uses Playwright for end-to-end testing running in Docker Compose. The tests cover every user-facing feature of the website.

## Test Infrastructure

Three Docker containers simulate the real Cloudflare infrastructure:

| Container | What it runs | Simulates |
|-----------|-------------|-----------|
| `api` | `wrangler dev --local` | Cloudflare Worker + D1 (local SQLite) + R2 (local) |
| `frontend` | `vite dev` | Cloudflare Pages |
| `playwright` | Playwright test runner | User browser (Chromium) |

Each E2E run uses a unique Docker Compose project name prefixed with `lunchbench-e2e-`.
The runner removes its containers, networks, and volumes on success, failure, or interruption
by running:

```bash
docker compose -p <project> down -v --remove-orphans
```

The script does not delete Docker images.

## Running Tests

### Git hook (automatic — runs on every `git push`)

The pre-push hook runs `scripts/run-e2e.sh` automatically before every push.
**You do not need to run tests manually before pushing.** The hook does it for you.

The hook is installed at `.git/hooks/pre-push`. To re-install it:

```bash
./scripts/install-hooks.sh
```

### Run tests manually (debugging only)

```bash
./scripts/run-e2e.sh
```

### View test report after a run

```bash
cd e2e && npx playwright show-report
```

### Clean up stale Docker resources

The runner should clean up after itself. If a host crash or forced Docker shutdown leaves
stale resources behind, remove only Lunchbench E2E containers, networks, and volumes with:

```bash
docker ps -a --filter 'name=lunchbench-e2e' --format '{{.ID}}' | xargs -r docker rm -f
docker network ls --filter 'name=lunchbench-e2e' --format '{{.ID}}' | xargs -r docker network rm
docker volume ls --filter 'name=lunchbench-e2e' --format '{{.Name}}' | xargs -r docker volume rm -f
```

### Run tests in headed mode (debug)

```bash
cd e2e && BASE_URL=http://localhost:5173 API_URL=http://localhost:8787 E2E_ADMIN_TOKEN=test-admin-token npx playwright test --headed
```

## What is Tested

- **Navigation**: all three pages accessible, active link highlighting, logo/link navigation, SPA routing
- **Theme**: light/dark toggle, persistence, icon updates
- **Home / Voting**: matchup loads, cards display, vote buttons work, vote submission, sequential voting, button disabled during submission
- **Leaderboard**: all lunches shown, rank badges (gold/silver/bronze), ratings, Glicko updates after voting, thumbnails/placeholders
- **Add Lunch**: mode switching, text-only add, authentication, error states, image upload area, client-side file validation
- **API**: health, matchup, vote (win + tie), invalid requests, auth, image upload rejection
- **Sodabench swipe**: deck loads with progress, right/left via buttons, arrow keys and drag, short drag snaps back, Deck done and Start over, unswiped-first deck order, arrow keys do not leak to other routes
- **Sodabench report**: Like/Hate disabled until a pick, autocomplete, submit closes the modal and records the report, same-day newer report replaces the older one, Escape closes without reporting
- **Soda leaderboard**: Lunch/Soda tabs, every drink ranked with type tag and swipe counts or "New soda/seltzer to try", images served from R2, swipes move a drink up
- **Barcode scan** (camera projects below): touch devices open the report in scan mode with the rear camera; scan, match, Like and report; unknown code is logged, picked manually, reported, mapped, and matches on the next scan (same page and after reload); denied permission and no camera API land in manual search with no error; the camera stops (every track `ended`) on close, Escape, match, "Select manually", route change and page hidden; no request body carries image data (only small same-origin JSON of scalars)
- **Admin unknown scans**: only admin sessions can read, map or dismiss; the Unknown scans tab shows scans, distinct voters, the drink picked afterwards and the mapping, never session keys; Map writes the mapping; Dismiss removes the code
- **Purchaser `/chris`**: password gate, wrong and lunch passwords rejected, order list slot order (4 Soda, 4 Seltzer, then one soda Trial and one seltzer Trial, no Backup), session persists across reload, log out, lunch PDF export, purchaser has no admin or lunch powers, admin regenerate is reproducible

### Fake camera

Barcode tests run the real decoder on Chromium's fake camera. `e2e/fixtures/barcode-video.ts` writes Y4M clips (a still UPC-A, black on white) when the Playwright config loads. A clip is fixed per browser launch, so there is one Playwright project per clip, each a Pixel 5 emulation (touch, coarse pointer) launched with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and `--use-file-for-fake-video-capture=<clip>`:

| Project | Clip | Spec |
|---------|------|------|
| `camera-blank` | blank frame (scanning never ends) | `barcode-scan-camera.spec.ts` |
| `camera-known` | `049000006346` (Coca-Cola can; the test maps it to Coca-Cola Original first) | `barcode-scan-known.spec.ts` |
| `camera-unknown` | `012345678905` (valid, unmapped) | `barcode-scan-unknown.spec.ts` |

The default `chromium` project ignores these specs. The SPA is served from `http://frontend:5173`, which is not a secure context, so the camera projects also pass `--unsafely-treat-insecure-origin-as-secure=<BASE_URL origin>`. Headless Chromium on Linux has no `BarcodeDetector`, so E2E exercises the zxing-wasm fallback. The native path is covered by format mapping unit tests only. Denied permission and a missing camera API are simulated with an init script that replaces `getUserMedia`; camera tracks are observed with an init script that records the streams `getUserMedia` returns (it does not change them).

The API container seeds 14 sodas and seltzers from `migrations/seed.sql`, maps their barcodes with `0014_soda_barcodes_seed.sql`, and uploads placeholder images from `scripts/data/seed-images` with `scripts/import-sodas.mjs upload --local`. E2E passwords are placeholders set in `docker-compose.e2e.yml`: `test-admin-token` (lunch), `test-admin-manager-password` (admin), `test-purchaser-password` (purchaser).

## MANDATORY POLICY - READ CAREFULLY

### Tests must never be bypassed.

**Do not use `git push --no-verify`.** This is a hard rule.

If tests are failing, you have two options:

1. **Fix the failing test.** If the test is correct and a feature is broken, fix the feature.
2. **If the cause is unknown**, follow this procedure:
   a. Create a GitHub issue describing the failure: exact test name, error message, reproduction steps
   b. Label it `testing` and `pm`
   c. Immediately begin working to fix it - the issue must be resolved before the push proceeds
   d. Do not proceed with the push until tests pass

### Why this rule exists

- The tests are the only thing that verifies the app works end-to-end after every change
- A passing test suite gives confidence that voting, Glicko ratings, the leaderboard, image handling, and auth all work together
- Bypassing is irreversible once code is in main - bugs reach production

### If a test is flaky (intermittently fails without code changes)

Create a GitHub issue labeled `testing` with:
- Which test is flaky
- How to reproduce
- Current failure rate

Investigate and fix the flakiness before it becomes a blocker. Do not mark flaky tests as skipped without creating an issue first.
