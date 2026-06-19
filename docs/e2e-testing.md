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

## Running Tests

### Install the pre-push hook (one-time setup)

```bash
./scripts/install-hooks.sh
```

### Run tests manually

```bash
./scripts/run-e2e.sh
```

### View test report after a run

```bash
cd e2e && npx playwright show-report
```

### Run tests in headed mode (debug)

```bash
cd e2e && BASE_URL=http://localhost:5173 API_URL=http://localhost:8787 E2E_ADMIN_TOKEN=test-admin-token npx playwright test --headed
```

## What is Tested

- **Navigation**: all three pages accessible, active link highlighting, logo/link navigation, SPA routing
- **Theme**: light/dark toggle, persistence, icon updates
- **Home / Voting**: matchup loads, cards display, vote buttons work, vote submission, sequential voting, button disabled during submission
- **Leaderboard**: all lunches shown, rank badges (gold/silver/bronze), ratings, Elo updates after voting, thumbnails/placeholders
- **Add Lunch**: mode switching, text-only add, authentication, error states, image upload area, client-side file validation
- **API**: health, matchup, vote (win + tie), invalid requests, auth, image upload rejection

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
- A passing test suite gives confidence that voting, Elo, the leaderboard, image handling, and auth all work together
- Bypassing is irreversible once code is in main - bugs reach production

### If a test is flaky (intermittently fails without code changes)

Create a GitHub issue labeled `testing` with:
- Which test is flaky
- How to reproduce
- Current failure rate

Investigate and fix the flakiness before it becomes a blocker. Do not mark flaky tests as skipped without creating an issue first.
