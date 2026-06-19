# Lunchbench

Compare lunch options head-to-head and let Elo ratings decide the best lunch.

**Live:** https://lunchbench.pages.dev (pending Pages deploy) · API: https://lunchbench-api.woodamca.workers.dev

## Architecture

- **Frontend**: Cloudflare Pages (Vite + TypeScript SPA)
- **API**: Cloudflare Worker (Hono + TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Images**: Cloudflare R2 (pending activation)

See [docs/architecture.md](docs/architecture.md) for details.

## Quick Start

See [docs/local-dev.md](docs/local-dev.md) for setup instructions.

## Deployment

See [docs/deployment.md](docs/deployment.md) for deployment instructions.

## Secrets

See [docs/secrets.md](docs/secrets.md) for secret management.
