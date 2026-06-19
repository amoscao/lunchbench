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
      → D1 (reads/writes for lunch data, votes, rate limits)
      → R2 (image reads/writes)
```

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
